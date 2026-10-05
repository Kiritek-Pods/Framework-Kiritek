"use strict";

/**
 * Defaults de la configuración engineering que no vienen del catálogo
 * (ejecución, evidencia, excepciones, telemetría). Independientes de
 * `src/config/defaults.js` (security): no se comparten niveles ni modos.
 */

const os = require("node:os");

const CONFIG_FILE = "kiritek-engineering.config.json";

function executionDefaults(cpuCount = os.cpus().length || 1) {
  return {
    maxProcesses: Math.max(1, Math.min(4, cpuCount)),
    maxMemoryMb: 1024,
    budgetsMs: { agent: 1500, "pre-commit": 5000, pr: 600000, release: 900000 },
    offline: false,
    cacheDirectory: ".kiritek/cache/engineering",
  };
}

const EVIDENCE_DEFAULTS = Object.freeze({ directory: ".kiritek/evidence/engineering", retentionDays: 30 });
const EXCEPTIONS_DEFAULTS = Object.freeze({
  waiverFiles: [".kiritek/engineering/waivers/*.json"],
  notApplicableFiles: [".kiritek/engineering/not-applicable/*.json"],
});
const TELEMETRY_DEFAULTS = Object.freeze({
  enabled: false,
  endpoint: null,
  retentionDays: 14,
  categories: ["control-status", "duration", "cache"],
});
const WORKSPACE_DEFAULTS = Object.freeze({ inheritProfiles: false, sharedPaths: [], onAmbiguousImpact: "expand" });

module.exports = {
  CONFIG_FILE,
  executionDefaults,
  EVIDENCE_DEFAULTS,
  EXCEPTIONS_DEFAULTS,
  TELEMETRY_DEFAULTS,
  WORKSPACE_DEFAULTS,
};
