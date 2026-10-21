"use strict";

/**
 * Registro de la última ejecución por momento (T15.1): fuente de
 * `lastRun`/`lastResult` de la auditoría. Sólo identidad, estado y decisión
 * por unidad/control; cruza la publicación del pack (schema + redacción).
 */

const fs = require("node:fs");
const path = require("node:path");
const { publishJson } = require("../privacy/publish.js");
const { hashJson } = require("../canonical.js");

const MOMENTS = Object.freeze(["agent", "pre-commit", "pr", "release"]);
const relFor = (directory, moment) => `${directory}/runs/${moment}.json`;

/**
 * Huella de la config efectiva de UN par unidad/control (nivel, parámetros y
 * perfiles). Excluye flags de ejecución (offline, presupuestos): una corrida
 * `--offline` no es drift de configuración.
 */
function controlConfigHash(resolvedConfig, unitId, controlId) {
  const u = resolvedConfig.effective.units.find((x) => x.unit.id === unitId);
  if (!u || !u.controls[controlId]) return null;
  return hashJson({ control: u.controls[controlId], profiles: u.unit.profiles.map((p) => `${p.id}@${p.version}`).sort() });
}

/** Proyección mínima de un reporte de ejecución. */
function ledgerFromReport(report, { at, surface, resolvedConfig } = {}) {
  return {
    schemaVersion: 1,
    moment: report.moment,
    at,
    revision: report.revision,
    configHash: report.configHash,
    catalog: report.catalog,
    ...(surface ? { surface } : {}),
    results: report.results.map((e) => ({
      unitId: e.unit.id,
      controlId: e.control.id,
      controlVersion: e.control.version,
      level: e.level,
      ...(resolvedConfig && controlConfigHash(resolvedConfig, e.unit.id, e.control.id) ? { controlConfigHash: controlConfigHash(resolvedConfig, e.unit.id, e.control.id) } : {}),
      state: e.state,
      decision: e.result ? e.result.decision : "none",
      blockingEligible: e.blockingEligible,
      evidenceClass: e.evidenceClass,
      evidenceFreshness: e.evidenceFreshness,
      evidenceCompleteness: e.evidenceCompleteness,
      ...(e.evidence ? { evidenceRef: e.evidence.id } : {}),
      durationMs: Math.max(0, Math.round(e.durationMs || 0)),
      findings: e.result ? e.result.findings.filter((f) => f.status !== "suppressed").length : 0,
      suppressed: e.suppressed.length,
    })),
  };
}

function writeRunLedger({ repoRoot, directory, report, at, surface, canaries, resolvedConfig }) {
  const rel = relFor(directory, report.moment);
  publishJson(repoRoot, rel, ledgerFromReport(report, { at, surface, resolvedConfig }), { schema: "engineering/run-ledger", canaries });
  return rel;
}

/** @returns {{ledgers: Record<string, object>, diagnostics: object[]}} */
function readRunLedgers({ repoRoot, directory }) {
  const ledgers = {};
  const diagnostics = [];
  for (const m of MOMENTS) {
    const abs = path.join(repoRoot, ...relFor(directory, m).split("/"));
    if (!fs.existsSync(abs)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (doc.schemaVersion !== 1 || doc.moment !== m || !Array.isArray(doc.results)) throw new Error("forma");
      ledgers[m] = doc;
    } catch (_) {
      diagnostics.push({ code: "RUN_LEDGER_INVALID", message: `registro de ejecución ${m} ilegible: se ignora` });
    }
  }
  return { ledgers, diagnostics };
}

module.exports = { MOMENTS, controlConfigHash, ledgerFromReport, writeRunLedger, readRunLedgers, relFor };
