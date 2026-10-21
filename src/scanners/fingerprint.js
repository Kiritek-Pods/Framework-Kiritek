"use strict";

/**
 * Fingerprints estables y normalización de rutas.
 *
 * El fingerprint identifica un hallazgo de forma reproducible entre ejecuciones
 * sin revelar el valor sensible. Se calcula a partir de metadatos de ubicación
 * (ruta relativa, regla, número de línea) y, opcionalmente, un hash del valor
 * — NUNCA el valor en claro. (Requisitos 2.7, 3.8, 13.3.)
 *
 * La normalización de rutas garantiza rutas relativas al repo, con separador
 * `/`, y rechaza escapes fuera del repositorio (path traversal / symlink
 * fuera de árbol).
 */

const crypto = require("crypto");
const path = require("path");

/**
 * Hash corto y estable de un valor sensible, para distinguir hallazgos sin
 * exponer el secreto. Se usa SHA-256 truncado; no es reversible.
 */
function hashSecret(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("hashSecret requiere un string no vacío");
  }
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/**
 * Normaliza una ruta a forma relativa POSIX respecto a `repoRoot`.
 *
 * @param {string} repoRoot  Raíz absoluta del repositorio.
 * @param {string} target    Ruta (absoluta o relativa) a normalizar.
 * @returns {string} ruta relativa con separadores `/`.
 * @throws si la ruta escapa del repositorio.
 */
function normalizeRepoPath(repoRoot, target) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("repoRoot debe ser un string no vacío");
  }
  if (typeof target !== "string" || target.trim() === "") {
    throw new TypeError("target debe ser un string no vacío");
  }
  const absRoot = path.resolve(repoRoot);
  const absTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(absRoot, target);

  const rel = path.relative(absRoot, absTarget);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`ruta fuera del repositorio: ${target}`);
  }
  // Normaliza a separador POSIX para fingerprints estables entre plataformas.
  return rel.split(path.sep).join("/");
}

/**
 * Construye un fingerprint estable de un hallazgo.
 *
 * @param {object} input
 * @param {string} input.path       Ruta relativa (ya normalizada).
 * @param {string} input.ruleId     Regla que disparó.
 * @param {number} [input.lineNumber] Línea (no el contenido).
 * @param {string} [input.secret]   Valor sensible (sólo para hashear; no se guarda).
 * @returns {string}
 */
function buildFingerprint(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("buildFingerprint requiere un objeto");
  }
  if (typeof input.path !== "string" || input.path.trim() === "") {
    throw new TypeError("fingerprint.path requerido");
  }
  if (typeof input.ruleId !== "string" || input.ruleId.trim() === "") {
    throw new TypeError("fingerprint.ruleId requerido");
  }
  const parts = [input.path, input.ruleId];
  parts.push(input.lineNumber !== undefined ? String(input.lineNumber) : "-");
  if (input.secret !== undefined) {
    parts.push(hashSecret(input.secret));
  }
  return parts.join(":");
}

module.exports = {
  hashSecret,
  normalizeRepoPath,
  buildFingerprint,
};
