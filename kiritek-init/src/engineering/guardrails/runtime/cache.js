"use strict";

/**
 * Cache de observaciones (T07.3–T07.4; design §13).
 *
 * Clave = sha256 de la identidad completa:
 *   packId | catalogDigest | controlId@version | collectorVersions | unitId |
 *   profileVersions | revision | scopeHash | inputManifestHash | configHash |
 *   platformKey | momentContractVersion
 *
 * - Cache no es confianza: cada lectura re-verifica checksum, identidad,
 *   expiración y contrato de cada observación. Lo corrupto/expirado/ajeno se
 *   borra y cuenta como miss con diagnóstico.
 * - Un hit nunca eleva confianza: se devuelve tal cual se guardó, marcado
 *   `cache: "hit"`.
 * - Sólo se guardan conjuntos completos (sin parciales/timeouts/inválidas).
 * - Escritura atómica (tmp + rename) con lock de dueño/TTL; un error de disco
 *   (p. ej. ENOSPC) no rompe la ejecución: se informa y no queda basura.
 * - Antes de escribir, el contenido pasa el validador de privacidad.
 */

const nodeFs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { canonicalJson, hashJson, sha256Of } = require("../canonical.js");
const { createObservation } = require("../contracts/observation.js");
const { assertNoLeaks } = require("../privacy/validate-output.js");

const SCHEMA_VERSION = 1;
const KEY_PARTS = Object.freeze([
  "packId",
  "catalogDigest",
  "controlId",
  "controlVersion",
  "collectorVersions",
  "unitId",
  "profileVersions",
  "revision",
  "scopeHash",
  "inputManifestHash",
  "configHash",
  "platformKey",
  "momentContractVersion",
]);
const IDENTITY_FIELDS = Object.freeze(["revision", "scopeHash", "configHash", "catalogDigest", "unitId", "controlId"]);

function keyFor(parts) {
  for (const k of KEY_PARTS) {
    if (parts[k] === undefined || parts[k] === null || parts[k] === "") throw new TypeError(`clave de cache incompleta: falta ${k}`);
  }
  for (const k of Object.keys(parts)) if (!KEY_PARTS.includes(k)) throw new TypeError(`parte de clave desconocida: ${k}`);
  return hashJson(parts);
}

/**
 * @param {object} opts
 * @param {string} opts.root            Directorio de cache (absoluto, dentro del repo o de la cache de usuario).
 * @param {() => string} [opts.clock]
 * @param {object} [opts.fs]            fs inyectable (pruebas de disco lleno/carreras).
 * @param {(entry) => void} [opts.validateEntry]  Validador de privacidad (lanza si no publicable).
 * @param {number} [opts.lockTtlMs]
 */
function createObservationCache(opts) {
  const fs = opts.fs || nodeFs;
  const clock = opts.clock || (() => new Date().toISOString());
  const lockTtlMs = opts.lockTtlMs || 30000;
  // Por defecto toda entrada pasa el detector de privacidad antes de escribirse.
  const validateEntry = opts.validateEntry || ((entry) => assertNoLeaks(entry, { canaries: opts.canaries }));
  const owner = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

  const fileFor = (key) => {
    const hex = key.slice("sha256:".length);
    return path.join(opts.root, hex.slice(0, 2), `${hex}.json`);
  };
  const remove = (file) => {
    try {
      fs.rmSync(file, { force: true });
    } catch (_) {
      /* mejor esfuerzo */
    }
  };

  function get(parts) {
    const key = keyFor(parts);
    const file = fileFor(key);
    if (!fs.existsSync(file)) return { status: "miss" };
    const invalid = (code, message) => {
      remove(file);
      return { status: "miss", diagnostic: { code, message } };
    };
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      return invalid("CACHE_CORRUPT", "entrada de cache ilegible; se descarta");
    }
    if (!entry || entry.schemaVersion !== SCHEMA_VERSION || entry.key !== key) return invalid("CACHE_CORRUPT", "entrada de cache con forma o clave inválida");
    if (canonicalJson(entry.parts) !== canonicalJson(parts)) return invalid("CACHE_IDENTITY_MISMATCH", "entrada de cache de otra identidad");
    if (sha256Of(canonicalJson(entry.observations)) !== entry.checksum) return invalid("CACHE_CORRUPT", "checksum de cache no coincide");
    if (Date.parse(entry.expiresAt) <= Date.parse(clock())) return invalid("CACHE_EXPIRED", "entrada de cache expirada");
    let observations;
    try {
      observations = entry.observations.map((o) => {
        const obs = createObservation({ ...o, cache: "hit" });
        for (const f of IDENTITY_FIELDS) {
          const expected = f === "catalogDigest" ? parts.catalogDigest : parts[f];
          if (obs[f] !== expected) throw new Error(f);
        }
        if (obs.status !== "complete") throw new Error("status");
        return obs;
      });
    } catch (_) {
      return invalid("CACHE_IDENTITY_MISMATCH", "observación cacheada inválida o de otra identidad");
    }
    return { status: "hit", observations, createdAt: entry.createdAt };
  }

  function acquireLock(lockFile) {
    const body = JSON.stringify({ owner, expiresAt: Date.now() + lockTtlMs });
    try {
      fs.writeFileSync(lockFile, body, { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        const held = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (held.expiresAt > Date.now()) return false;
      } catch (_) {
        /* lock ilegible ⇒ se considera vencido */
      }
      remove(lockFile);
      try {
        fs.writeFileSync(lockFile, body, { flag: "wx" });
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  /**
   * @returns {{status: "written"|"skipped"|"locked"|"error", diagnostic?}}
   */
  function set(parts, observations, { ttlSeconds }) {
    const key = keyFor(parts);
    if (!observations.length || observations.some((o) => o.status !== "complete")) {
      return { status: "skipped", diagnostic: { code: "CACHE_SKIPPED_INCOMPLETE", message: "sólo se cachean conjuntos de observaciones completos" } };
    }
    if (!ttlSeconds) return { status: "skipped" };
    const createdAt = clock();
    const stored = observations.map((o) => ({ ...JSON.parse(JSON.stringify(o)), cache: "miss" }));
    const entry = {
      schemaVersion: SCHEMA_VERSION,
      key,
      parts,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + ttlSeconds * 1000).toISOString(),
      outputSchema: "engineering/observation@1",
      redactionPolicyVersion: "1.0.0",
      checksum: sha256Of(canonicalJson(stored)),
      observations: stored,
    };
    try {
      validateEntry(entry);
    } catch (_) {
      return { status: "skipped", diagnostic: { code: "CACHE_REDACTION_FAILED", message: "la entrada no pasó la validación de privacidad; no se cachea" } };
    }
    const file = fileFor(key);
    const lockFile = `${file}.lock`;
    const tmp = `${file}.${owner}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!acquireLock(lockFile)) return { status: "locked", diagnostic: { code: "CACHE_LOCKED", message: "otra ejecución está escribiendo la misma entrada" } };
      try {
        fs.writeFileSync(tmp, JSON.stringify(entry));
        fs.renameSync(tmp, file);
      } finally {
        remove(tmp);
        remove(lockFile);
      }
      return { status: "written" };
    } catch (e) {
      return { status: "error", diagnostic: { code: e.code === "ENOSPC" ? "CACHE_DISK_FULL" : "CACHE_WRITE_FAILED", message: "no se pudo escribir la cache; se continúa sin ella" } };
    }
  }

  return { keyFor, get, set, root: opts.root };
}

module.exports = { KEY_PARTS, keyFor, createObservationCache };
