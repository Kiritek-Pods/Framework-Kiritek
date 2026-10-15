"use strict";

/**
 * Eventos de telemetría engineering (T15A.1, R20). Minimizados por
 * construcción: sólo IDs, versiones, estado, duración, cache y categoría de
 * error. Nunca código, rutas, findings, razones ni datos de producto; la
 * unidad viaja como referencia pseudónima (hash). Cada evento pasa por una
 * allowlist estricta y por el detector de fugas del pack.
 */

const { hashJson } = require("../canonical.js");
const { assertNoLeaks } = require("../privacy/validate-output.js");

const SCHEMA_VERSION = 1;
const CATEGORIES = Object.freeze(["control-status", "duration", "cache", "error-category"]);
const ERROR_CATEGORIES = Object.freeze(["none", "timeout", "unavailable", "conflict", "stale", "config", "internal"]);
const VERDICTS = Object.freeze(["confirmed", "false-positive"]);

const BASE_FIELDS = ["schemaVersion", "type", "id", "at", "packId", "catalogVersion", "catalogDigest", "controlId", "controlVersion", "unitRef", "moment", "level", "platformKey"];
const FIELDS = Object.freeze({
  "control-run": {
    always: BASE_FIELDS,
    "control-status": ["state", "decision", "blocking", "findings", "suppressed"],
    duration: ["durationMs"],
    cache: ["cache"],
    "error-category": ["errorCategory"],
  },
  "finding-feedback": { always: ["schemaVersion", "type", "id", "at", "packId", "controlId", "controlVersion", "ruleId", "fingerprintRef", "verdict", "remediationMinutes"] },
});

const unitRef = (unitId) => `u-${hashJson({ unitId }).slice(7, 23)}`;

function errorCategory(e) {
  if (e.state === "timeout") return "timeout";
  if (e.state === "unavailable") return "unavailable";
  if (e.state === "conflict") return "conflict";
  if (e.state === "stale") return "stale";
  if (e.result && e.result.decision === "error") return (e.diagnostics || []).some((d) => /TIMEOUT/.test(d.code)) ? "timeout" : "internal";
  return "none";
}

/** Recorta un evento a su allowlist y verifica que no haya fugas. */
function sanitizeEvent(event, { categories = CATEGORIES, canaries = [] } = {}) {
  const spec = FIELDS[event.type];
  if (!spec) throw Object.assign(new Error(`tipo de evento desconocido ${event.type}`), { code: "TELEMETRY_INVALID" });
  const allowed = new Set([...spec.always, ...categories.flatMap((cat) => spec[cat] || [])]);
  const out = {};
  for (const k of Object.keys(event)) if (allowed.has(k) && event[k] !== undefined) out[k] = event[k];
  assertNoLeaks(out, { canaries });
  return out;
}

/**
 * Eventos `control-run` de un reporte. `id` es determinista (idempotencia):
 * el mismo resultado de la misma ejecución produce la misma clave.
 */
function runEvents(report, { at, platformKey, categories, canaries } = {}) {
  return report.results
    .filter((e) => e.state !== "not_applicable" && e.state !== "off")
    .map((e) => {
      const raw = {
        schemaVersion: SCHEMA_VERSION,
        type: "control-run",
        at,
        packId: report.packId,
        catalogVersion: report.catalog.version,
        catalogDigest: report.catalog.digest,
        controlId: e.control.id,
        controlVersion: e.control.version,
        unitRef: unitRef(e.unit.id),
        moment: report.moment,
        level: e.level,
        platformKey: platformKey || "unknown",
        state: e.state,
        decision: e.result ? e.result.decision : "none",
        blocking: !!(e.blockingEligible && e.result && e.result.decision === "deny"),
        findings: e.result ? e.result.findings.filter((f) => f.status !== "suppressed").length : 0,
        suppressed: e.suppressed.length,
        durationMs: Math.max(0, Math.round(e.durationMs || 0)),
        cache: e.cache,
        errorCategory: errorCategory(e),
      };
      raw.id = `evt-${hashJson({ k: [report.revision, report.configHash, raw.moment, raw.unitRef, raw.controlId, at] }).slice(7, 39)}`;
      return sanitizeEvent(raw, { categories, canaries });
    });
}

/** Feedback de calidad (R20.2): confirmación / falso positivo, sin contenido. */
function feedbackEvent({ controlId, controlVersion, ruleId, fingerprint, verdict, remediationMinutes, at }, opts = {}) {
  if (!VERDICTS.includes(verdict)) throw Object.assign(new Error(`veredicto inválido: ${verdict}`), { code: "TELEMETRY_INVALID" });
  if (remediationMinutes !== undefined && (!Number.isInteger(remediationMinutes) || remediationMinutes < 0)) {
    throw Object.assign(new Error("remediationMinutes debe ser entero ≥ 0"), { code: "TELEMETRY_INVALID" });
  }
  const fingerprintRef = `f-${hashJson({ fingerprint }).slice(7, 23)}`;
  return sanitizeEvent(
    {
      schemaVersion: SCHEMA_VERSION,
      type: "finding-feedback",
      id: `fb-${hashJson({ controlId, fingerprintRef, verdict, at }).slice(7, 39)}`,
      at,
      packId: "engineering/guardrails",
      controlId,
      controlVersion,
      ruleId,
      fingerprintRef,
      verdict,
      remediationMinutes,
    },
    opts
  );
}

/** Calidad por control (R20.1–R20.3): ejecuciones, errores y falsos positivos. */
function qualityByControl(events) {
  const q = {};
  const get = (id) => (q[id] = q[id] || { runs: 0, warnings: 0, denies: 0, errors: 0, timeouts: 0, confirmed: 0, falsePositives: 0 });
  for (const e of events) {
    const s = get(e.controlId);
    if (e.type === "control-run") {
      s.runs += 1;
      if (e.decision === "warn") s.warnings += 1;
      if (e.decision === "deny") s.denies += 1;
      if (e.decision === "error" || ["unavailable", "conflict"].includes(e.state)) s.errors += 1;
      if (e.state === "timeout" || e.errorCategory === "timeout") s.timeouts += 1;
    } else if (e.type === "finding-feedback") {
      if (e.verdict === "confirmed") s.confirmed += 1;
      else s.falsePositives += 1;
    }
  }
  for (const s of Object.values(q)) {
    const judged = s.confirmed + s.falsePositives;
    s.falsePositiveRate = judged ? s.falsePositives / judged : null;
    s.errorRate = s.runs ? (s.errors + s.timeouts) / s.runs : null;
  }
  return q;
}

/** Alertas agregadas (T15A.3): sólo contadores, nunca payloads. */
function aggregateAlerts(events, { errorRate = 0.1, falsePositiveRate = 0.1 } = {}) {
  const alerts = [];
  for (const [controlId, s] of Object.entries(qualityByControl(events))) {
    if (s.errorRate !== null && s.errorRate > errorRate) alerts.push({ category: "error-rate", controlId, value: Number(s.errorRate.toFixed(3)), runs: s.runs });
    if (s.falsePositiveRate !== null && s.falsePositiveRate > falsePositiveRate) alerts.push({ category: "false-positive-rate", controlId, value: Number(s.falsePositiveRate.toFixed(3)), judged: s.confirmed + s.falsePositives });
  }
  return alerts.sort((a, b) => (`${a.controlId}|${a.category}` < `${b.controlId}|${b.category}` ? -1 : 1));
}

module.exports = { SCHEMA_VERSION, CATEGORIES, ERROR_CATEGORIES, VERDICTS, unitRef, sanitizeEvent, runEvents, feedbackEvent, qualityByControl, aggregateAlerts };
