"use strict";

/**
 * Almacén de evidencia engineering (T08.4).
 *
 * Persiste `EngineeringEvidence` v2 (sólo metadatos: IDs, versiones, hashes,
 * revisión, unidad, scope, config, catálogo, plataforma, duración, referencias
 * y vigencia) tras el pipeline de publicación. La lectura re-valida contrato
 * y calcula frescura contra la identidad actual: evidencia de otra revisión,
 * config, catálogo, unidad o scope queda `stale` y nunca sustenta bloqueo.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createEngineeringEvidence, evaluateFreshness } = require("../contracts/evidence.js");
const { publishJson } = require("./publish.js");

function safeSegment(id) {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

function relPathFor(directory, evidence) {
  return [directory, safeSegment(evidence.unitId), safeSegment(evidence.control.id), `${safeSegment(evidence.id)}.json`].join("/");
}

/**
 * @param {object} opts { repoRoot, directory, evidence, canaries? }
 * @returns {string} ruta relativa escrita
 */
function writeEvidence({ repoRoot, directory, evidence, canaries }) {
  const ev = createEngineeringEvidence(JSON.parse(JSON.stringify(evidence)));
  const rel = relPathFor(directory, ev);
  publishJson(repoRoot, rel, ev, { schema: "engineering/evidence", canaries });
  return rel;
}

/**
 * Lee la evidencia de una unidad/control y calcula su frescura.
 * @returns {{entries: {path, evidence, freshness, reasons}[], diagnostics: object[]}}
 */
function readEvidence({ repoRoot, directory, unitId, controlId, expected, nowMs }) {
  const relDir = [directory, safeSegment(unitId), safeSegment(controlId)].join("/");
  const absDir = path.join(repoRoot, ...relDir.split("/"));
  const entries = [];
  const diagnostics = [];
  if (!fs.existsSync(absDir)) return { entries, diagnostics };
  for (const name of fs.readdirSync(absDir).filter((n) => n.endsWith(".json")).sort()) {
    const rel = `${relDir}/${name}`;
    try {
      const ev = createEngineeringEvidence(JSON.parse(fs.readFileSync(path.join(absDir, name), "utf8")));
      const f = evaluateFreshness(ev, expected, { now: nowMs });
      entries.push({ path: rel, evidence: ev, freshness: f.freshness, reasons: f.reasons });
    } catch (_) {
      diagnostics.push({ code: "EVIDENCE_INVALID", message: `${rel}: evidencia ilegible o fuera de contrato; se ignora` });
    }
  }
  return { entries, diagnostics };
}

module.exports = { writeEvidence, readEvidence, relPathFor };
