"use strict";

/**
 * Cache segura de catálogos (R4.6, R16; design §13, §17).
 *
 * - Cache no es confianza: cada lectura re-verifica digest/contrato.
 * - Entradas inmutables: misma versión con distinto digest es conflicto.
 * - Escritura atómica: directorio temporal + rename; nunca deja una versión
 *   a medio escribir visible.
 * - Entrada corrupta se pone en cuarentena y se trata como ausente.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { raise } = require("../errors.js");
const { readCatalogDir, loadCatalogFromFiles } = require("./load.js");
const { versionDir } = require("./registry.js");

function writeFileMap(dir, fileMap) {
  for (const rel of Object.keys(fileMap)) {
    if (rel.split("/").some((s) => s === ".." || s === "") || path.isAbsolute(rel)) {
      raise("CATALOG_UNSAFE_FILE", `ruta de archivo no permitida en catálogo: ${rel}`);
    }
    const target = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fileMap[rel]);
  }
}

/**
 * Escribe un catálogo verificado en la cache.
 * @returns {{status: "written"|"present", digest}}
 */
function writeToCache(cacheRoot, fileMap, opts = {}) {
  const loaded = loadCatalogFromFiles(fileMap, opts); // verifica antes de tocar disco
  const { version, digest } = loaded.catalog;
  if (opts.expectedVersion && opts.expectedVersion !== version) {
    raise("CATALOG_VERSION_MISMATCH", `se esperaba ${opts.expectedVersion} y el artefacto es ${version}`);
  }
  if (opts.expectedDigest && opts.expectedDigest !== digest) {
    raise("CATALOG_DIGEST_PINNED_MISMATCH", `el digest de ${version} no coincide con el fijado`);
  }
  fs.mkdirSync(cacheRoot, { recursive: true });
  const finalDir = versionDir(cacheRoot, version);
  if (fs.existsSync(finalDir)) {
    const existing = readFromCache(cacheRoot, version, opts);
    if (existing && existing.catalog.digest === digest) return { status: "present", digest };
    if (existing) raise("CATALOG_CACHE_CONFLICT", `la cache ya tiene ${version} con otro digest; las versiones son inmutables`);
  }
  const tmp = path.join(cacheRoot, `.tmp-${version}-${crypto.randomBytes(6).toString("hex")}`);
  try {
    writeFileMap(tmp, fileMap);
    fs.renameSync(tmp, finalDir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (err.code === "ENOTEMPTY" || err.code === "EEXIST") {
      // Carrera con otro proceso: aceptar sólo si lo escrito es idéntico.
      const winner = readFromCache(cacheRoot, version, opts);
      if (winner && winner.catalog.digest === digest) return { status: "present", digest };
      raise("CATALOG_CACHE_CONFLICT", `carrera de escritura en cache para ${version}`);
    }
    throw err;
  }
  return { status: "written", digest };
}

/**
 * Lee y re-verifica una versión de la cache. Devuelve null si no existe o si
 * estaba corrupta (en cuyo caso queda en cuarentena y se informa en
 * `opts.onDiagnostic`).
 */
function readFromCache(cacheRoot, version, opts = {}) {
  const dir = versionDir(cacheRoot, version);
  if (!fs.existsSync(dir)) return null;
  try {
    return loadCatalogFromFiles(readCatalogDir(dir), opts);
  } catch (err) {
    if (err.code === "CATALOG_SIGNATURE_REQUIRED" || err.code === "CATALOG_SIGNATURE_UNTRUSTED") throw err;
    const quarantine = path.join(cacheRoot, `.corrupt-${version}-${crypto.randomBytes(4).toString("hex")}`);
    try {
      fs.renameSync(dir, quarantine);
    } catch (_) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (opts.onDiagnostic) {
      opts.onDiagnostic({
        code: "CATALOG_CACHE_CORRUPT",
        message: `entrada de cache ${version} inválida (${err.code || "error"}); se puso en cuarentena`,
        remediation: "Se reconstruirá desde una fuente verificada.",
      });
    }
    return null;
  }
}

/**
 * Descarga (fetcher inyectado) y escribe en cache tras verificar. En modo
 * offline nunca invoca al fetcher: sólo valen artefactos locales verificados.
 *
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.cacheRoot
 * @param {boolean} [opts.offline]
 * @param {(version: string) => Promise<Record<string, Buffer>>} opts.fetchCatalog
 * @param {string} [opts.expectedDigest]
 */
async function fetchIntoCache(opts) {
  if (opts.offline) {
    raise("CATALOG_OFFLINE", `modo offline: no se descarga el catálogo ${opts.version}`, {
      remediation: "Instale el catálogo verificado en la cache antes de trabajar offline.",
    });
  }
  if (typeof opts.fetchCatalog !== "function") raise("CATALOG_SOURCE_UNAVAILABLE", "no hay fuente de catálogo configurada");
  const fileMap = await opts.fetchCatalog(opts.version);
  return writeToCache(opts.cacheRoot, fileMap, {
    expectedVersion: opts.version,
    expectedDigest: opts.expectedDigest,
    trustedKeys: opts.trustedKeys,
    requireSignature: opts.requireSignature,
  });
}

module.exports = { writeToCache, readFromCache, fetchIntoCache };
