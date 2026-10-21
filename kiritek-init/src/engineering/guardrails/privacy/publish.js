"use strict";

/**
 * Publicación segura (T08.3): minimización → eliminación por campos →
 * sanitización → detector final → schema de salida → escritura atómica.
 * Cualquier fallo impide publicar; no hay escritura parcial.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { containReal } = require("../../../platform/paths.js");
const { raise } = require("../errors.js");
const { minimizeBySchema } = require("./minimize.js");
const { removeForbiddenFields, sanitizeStrings } = require("./redact.js");
const { assertNoLeaks, assertOutputSchema } = require("./validate-output.js");

const REDACTION_POLICY_VERSION = "1.0.0";

/**
 * @param {object} value
 * @param {object} opts { schema, repoRoot?, canaries? }
 * @returns {{value: object, removedFields: string[]}}
 */
function prepareForPublication(value, opts) {
  const minimized = minimizeBySchema(value, opts.schema);
  const { value: stripped, removed } = removeForbiddenFields(minimized);
  const sanitized = sanitizeStrings(stripped, { repoRoot: opts.repoRoot });
  assertNoLeaks(sanitized, { canaries: opts.canaries });
  assertOutputSchema(sanitized, opts.schema);
  return { value: sanitized, removedFields: removed };
}

/** Escribe JSON de forma atómica en una ruta relativa confinada al repo. */
function writeJsonAtomic(repoRoot, relPath, value) {
  const target = containReal(repoRoot, relPath);
  if (!target.contained) raise("PUBLISH_PATH_OUTSIDE_REPO", "el destino de publicación resuelve fuera del repositorio");
  const abs = target.realPath;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, abs);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return relPath;
}

/** Publica un objeto validado: nada se escribe si la validación falla. */
function publishJson(repoRoot, relPath, value, opts) {
  const { value: safe } = prepareForPublication(value, { ...opts, repoRoot });
  writeJsonAtomic(repoRoot, relPath, safe);
  return safe;
}

module.exports = { REDACTION_POLICY_VERSION, prepareForPublication, writeJsonAtomic, publishJson };
