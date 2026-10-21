"use strict";

/**
 * Carga de un catálogo desde disco o desde un mapa de archivos en memoria.
 *
 * El catálogo se lee una sola vez a memoria y desde ahí se verifica: cambios
 * posteriores en disco no alteran una snapshot ya resuelta (R4.6).
 */

const fs = require("node:fs");
const path = require("node:path");
const { validate, validateAgainst } = require("../../../domain/schema-validator.js");
const { createCatalog } = require("../contracts/catalog.js");
const { raise, GuardrailsError } = require("../errors.js");
const { CATALOG_FILE, verifyCatalogDigest, verifyCatalogSignature } = require("./verify.js");

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 256;

/** Lee un directorio de versión a `{ ruta relativa POSIX: Buffer }`. */
function readCatalogDir(dir) {
  const files = {};
  let count = 0;
  (function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        raise("CATALOG_UNSAFE_FILE", `el catálogo contiene un symlink (${relPath}); no se sigue`);
      }
      if (entry.isDirectory()) {
        walk(full, relPath);
      } else if (entry.isFile()) {
        count += 1;
        if (count > MAX_FILES) raise("CATALOG_UNSAFE_FILE", "el catálogo excede el número máximo de archivos");
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) raise("CATALOG_UNSAFE_FILE", `archivo de catálogo demasiado grande: ${relPath}`);
        files[relPath] = fs.readFileSync(full);
      }
    }
  })(dir, "");
  return files;
}

function parseJson(buf, rel) {
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf));
  } catch (err) {
    raise("CATALOG_PARSE", `JSON inválido en ${rel}`, { pointer: rel });
  }
}

/**
 * Valida y verifica un catálogo a partir de sus archivos.
 *
 * @param {Record<string, Buffer|string>} fileMap
 * @param {object} [opts] trustedKeys, requireSignature
 * @returns {{catalog, files, parameterSchemas, signature}}
 */
function loadCatalogFromFiles(fileMap, opts = {}) {
  if (!fileMap[CATALOG_FILE]) raise("CATALOG_NOT_FOUND", `falta ${CATALOG_FILE}`);
  const doc = parseJson(fileMap[CATALOG_FILE], CATALOG_FILE);

  const schemaCheck = validateAgainst("engineering/catalog", doc, { extended: true });
  if (!schemaCheck.valid) {
    raise("CATALOG_SCHEMA", `catálogo inválido: ${schemaCheck.errors.slice(0, 5).join("; ")}`, {
      pointer: CATALOG_FILE,
      remediation: "El catálogo publicado no cumple schemas/engineering/catalog.schema.json.",
    });
  }
  let catalog;
  try {
    catalog = createCatalog(doc);
  } catch (err) {
    raise("CATALOG_CONTRACT", `catálogo inválido: ${err.message}`, { pointer: CATALOG_FILE });
  }

  // Integridad antes de interpretar cualquier archivo referenciado.
  const files = verifyCatalogDigest(doc, fileMap);
  const signature = verifyCatalogSignature(doc, fileMap, opts);

  const parameterSchemas = {};
  for (const control of catalog.controls) {
    const ref = control.parametersSchemaRef;
    if (fileMap[ref] === undefined) {
      raise("CATALOG_REFERENCE_MISSING", `${control.id}: falta el schema de parámetros ${ref}`, { pointer: ref });
    }
    const schema = parseJson(fileMap[ref], ref);
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      raise("CATALOG_PARAMETERS_SCHEMA", `${control.id}: el schema de parámetros debe ser un objeto cerrado`, { pointer: ref });
    }
    const defaults = validate(control.defaults.parameters, schema, { extended: true });
    if (!defaults.valid) {
      raise("CATALOG_DEFAULTS_INVALID", `${control.id}: defaults inválidos: ${defaults.errors.join("; ")}`, { pointer: ref });
    }
    parameterSchemas[control.id] = schema;
  }

  return { catalog, files, parameterSchemas, signature };
}

function loadCatalogDir(dir, opts) {
  if (!fs.existsSync(path.join(dir, CATALOG_FILE))) raise("CATALOG_NOT_FOUND", "directorio de catálogo sin catalog.json");
  return loadCatalogFromFiles(readCatalogDir(dir), opts);
}

module.exports = { MAX_FILE_BYTES, readCatalogDir, loadCatalogFromFiles, loadCatalogDir, GuardrailsError };
