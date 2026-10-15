"use strict";

/**
 * Lectura común de contratos declarados por el equipo (controles T18–T21):
 * ruta contenida en el repo, JSON y schema. No interpreta el contenido: cada
 * control extrae sus HECHOS mínimos con su propio `factsOf`.
 */

const fs = require("node:fs");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");

/**
 * @param {string} repoRoot
 * @param {string|undefined} relPath  Ruta declarada en parameters.
 * @param {string} schemaId
 * @param {{prefix?: string, uniqueIds?: (doc) => boolean}} [opts]
 * @returns {{declared, valid, errorCodes, doc?}}
 */
function loadContractFile(repoRoot, relPath, schemaId, { prefix = "CONTRACT", uniqueIds } = {}) {
  if (!relPath) return { declared: false, valid: false, errorCodes: [] };
  const target = containReal(repoRoot, relPath);
  if (!target.contained) return { declared: true, valid: false, errorCodes: [`${prefix}_PATH_OUTSIDE_REPO`] };
  if (!fs.existsSync(target.realPath)) return { declared: true, valid: false, errorCodes: [`${prefix}_FILE_MISSING`] };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(target.realPath, "utf8"));
  } catch (_) {
    return { declared: true, valid: false, errorCodes: [`${prefix}_PARSE`] };
  }
  if (!validateAgainst(schemaId, doc, { extended: true }).valid) return { declared: true, valid: false, errorCodes: [`${prefix}_SCHEMA`] };
  if (uniqueIds && !uniqueIds(doc)) return { declared: true, valid: false, errorCodes: [`${prefix}_DUPLICATE_ID`] };
  return { declared: true, valid: true, errorCodes: [], doc };
}

/** true si `key(x)` no se repite en la lista. */
const unique = (list, key) => new Set((list || []).map(key)).size === (list || []).length;

module.exports = { loadContractFile, unique };
