"use strict";

/**
 * Persistencia segura de reportes de seguridad.
 *
 * Escribe resultados en un directorio administrado, siempre a través del
 * redactor y validando el schema antes de publicar. La escritura es atómica
 * (archivo temporal + rename) para no dejar reportes a medias. Si la redacción
 * falla (queda un canario) o el objeto no cumple el schema, no se escribe nada.
 *
 * (Requisitos 13.1, 13.3–13.5, 2.4, G.12.)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { safeSerialize } = require("./redactor.js");
const { validateAgainst } = require("../domain/schema-validator.js");

const DEFAULT_REPORT_DIR = ".kiritek/security";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Escribe un reporte de forma segura y atómica.
 *
 * @param {object} options
 * @param {string} options.repoRoot      Raíz del repositorio.
 * @param {string} [options.reportDir]   Directorio de reportes (relativo al repo).
 * @param {string} options.name          Nombre lógico del reporte (sin extensión).
 * @param {object} options.value         Objeto a persistir (p. ej. PolicyResult).
 * @param {string} [options.schemaName]  Si se indica, se valida contra ese schema.
 * @returns {{ jsonPath: string, bytes: number }}
 * @throws si la redacción falla o el objeto no cumple el schema.
 */
function writeReport(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("writeReport requiere opciones");
  }
  const { repoRoot, name, value, schemaName } = options;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("writeReport.repoRoot requerido");
  }
  if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new TypeError("writeReport.name debe ser un identificador simple [A-Za-z0-9._-]");
  }

  // 1. Validar schema ANTES de escribir (sobre el objeto original).
  if (schemaName) {
    const check = validateAgainst(schemaName, JSON.parse(JSON.stringify(value)));
    if (!check.valid) {
      const err = new Error(`reporte no cumple schema "${schemaName}": ${check.errors.join("; ")}`);
      err.code = "SCHEMA_INVALID";
      throw err;
    }
  }

  // 2. Redactar y detectar canarios. safeSerialize lanza si algo se escapó.
  const { json } = safeSerialize(value);

  // 3. Escritura atómica dentro del directorio administrado.
  const reportDirRel = options.reportDir || DEFAULT_REPORT_DIR;
  const reportDir = path.resolve(repoRoot, reportDirRel);
  // Defensa: el directorio de reportes debe quedar dentro del repo.
  const relCheck = path.relative(path.resolve(repoRoot), reportDir);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error("reportDir debe estar dentro del repositorio");
  }
  ensureDir(reportDir);

  const jsonPath = path.join(reportDir, `${name}.json`);
  const tmpPath = path.join(reportDir, `.${name}.${crypto.randomBytes(6).toString("hex")}.tmp`);

  fs.writeFileSync(tmpPath, json, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tmpPath, jsonPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* best-effort cleanup */
    }
    throw err;
  }

  return { jsonPath, bytes: Buffer.byteLength(json, "utf8") };
}

/**
 * Genera las entradas de ignore recomendadas para el directorio de reportes.
 * Las usará el reconciliador de ignores (tarea 7).
 */
function ignoreEntries(reportDir = DEFAULT_REPORT_DIR) {
  const dir = reportDir.replace(/\/+$/, "");
  return [`${dir}/`];
}

module.exports = {
  DEFAULT_REPORT_DIR,
  writeReport,
  ignoreEntries,
};
