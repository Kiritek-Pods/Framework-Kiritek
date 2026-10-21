"use strict";

/** Lectura y validación del contrato conductual del equipo (T10.1). */

const fs = require("node:fs");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");

const SCHEMA = "engineering/controls/search-input-rate.contract";

/**
 * @returns {{declared: boolean, valid: boolean, errorCodes: string[], contract?: object}}
 */
function loadBehaviorContract(repoRoot, relPath) {
  if (!relPath) return { declared: false, valid: false, errorCodes: [] };
  const target = containReal(repoRoot, relPath);
  if (!target.contained) return { declared: true, valid: false, errorCodes: ["CONTRACT_PATH_OUTSIDE_REPO"] };
  if (!fs.existsSync(target.realPath)) return { declared: true, valid: false, errorCodes: ["CONTRACT_FILE_MISSING"] };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(target.realPath, "utf8"));
  } catch (_) {
    return { declared: true, valid: false, errorCodes: ["CONTRACT_PARSE"] };
  }
  const check = validateAgainst(SCHEMA, doc, { extended: true });
  if (!check.valid) return { declared: true, valid: false, errorCodes: ["CONTRACT_SCHEMA"] };
  return { declared: true, valid: true, errorCodes: [], contract: doc };
}

module.exports = { SCHEMA, loadBehaviorContract };
