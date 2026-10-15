"use strict";

/**
 * Contrato de política de versión mínima (T11.1): lectura, validación de
 * forma y extracción de HECHOS mínimos (enums/booleanos/números). No se
 * copian endpoints, claves ni identificadores al resultado.
 */

const fs = require("node:fs");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");

const SCHEMA = "engineering/controls/app-minimum-supported-version.contract";

function factsOf(doc) {
  return {
    versionScheme: doc.versionScheme,
    environments: Object.entries(doc.environments)
      .map(([name, e]) => ({
        name,
        sourceKind: e.source.kind,
        authenticity: e.source.authenticity,
        hasKeyId: !!e.source.keyId,
        cacheTtlSeconds: e.cacheTtlSeconds,
        staleIfOfflineSeconds: e.staleIfOfflineSeconds,
        timeoutMs: e.timeoutMs,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    offline: { ...doc.offline },
    grace: { allowed: doc.grace.allowed, timeSource: doc.grace.timeSource || null, maxDays: doc.grace.maxDays || null },
    hard: { ...doc.hard },
    soft: { ...doc.soft },
    stores: doc.stores.map((s) => ({ ...s })),
    rollback: { ...doc.rollback },
    override: { ...doc.override, scopedBy: [...doc.override.scopedBy].sort() },
    observability: { events: [...doc.observability.events].sort(), identifiers: doc.observability.identifiers },
    harnessKind: doc.harness.kind,
  };
}

/** @returns {{declared, valid, errorCodes, contract?, facts?}} */
function loadPolicyContract(repoRoot, relPath) {
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
  if (!validateAgainst(SCHEMA, doc, { extended: true }).valid) return { declared: true, valid: false, errorCodes: ["CONTRACT_SCHEMA"] };
  return { declared: true, valid: true, errorCodes: [], contract: doc, facts: factsOf(doc) };
}

module.exports = { SCHEMA, loadPolicyContract, factsOf };
