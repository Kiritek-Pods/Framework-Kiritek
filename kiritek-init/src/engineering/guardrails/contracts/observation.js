"use strict";

/**
 * Observation: dato normalizado que produce un collector (R6, R7).
 *
 * Un collector observa; no decide. Por eso este contrato no admite
 * `decision`, `severity` ni `blockingEligible`. Fallos, parciales y timeouts
 * se preservan como estado explícito con limitaciones (R6.3).
 */

const c = require("./common.js");

const SCHEMA_VERSION = 1;
const OBSERVATION_STATUS = Object.freeze({
  COMPLETE: "complete",
  PARTIAL: "partial",
  UNAVAILABLE: "unavailable",
  TIMEOUT: "timeout",
  INVALID: "invalid",
  CONFLICT: "conflict",
});
const OBSERVATION_STATUSES = Object.freeze(Object.values(OBSERVATION_STATUS));
const REVISION_RE = /^[0-9a-f]{7,64}$/;
const KEYS = [
  "schemaVersion",
  "observationId",
  "kind",
  "controlId",
  "unitId",
  "source",
  "revision",
  "scopeHash",
  "configHash",
  "catalogDigest",
  "observedAt",
  "status",
  "confidence",
  "evidenceClass",
  "facts",
  "limitations",
  "durationMs",
  "cache",
];
/** Campos de decisión que un collector jamás puede emitir (R6.1). */
const DECISION_FIELDS = Object.freeze(["decision", "severity", "blockingEligible", "allow", "deny"]);

function assertRevision(v, label) {
  if (typeof v !== "string" || !REVISION_RE.test(v)) c.fail(`${label} debe ser un commit hex (7–64)`, "INVALID_REVISION");
}

function assertNoDecisionFields(value, label, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (DECISION_FIELDS.includes(key)) c.fail(`${label}: un collector no puede emitir "${key}" (R6.1)`, "COLLECTOR_DECISION");
    assertNoDecisionFields(value[key], `${label}.${key}`, seen);
  }
}

function createObservation(input) {
  c.assertObject(input, "observation");
  assertNoDecisionFields(input, "observation");
  c.assertKnownKeys(input, KEYS, "observation");
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`observation.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }

  c.assertRef(input.observationId, "observation.observationId");
  c.assertRef(input.kind, "observation.kind");
  c.assertControlId(input.controlId, "observation.controlId");
  c.assertNamespacedId(input.unitId, "observation.unitId");

  c.assertObject(input.source, "observation.source");
  c.assertKnownKeys(input.source, ["collectorId", "version", "mechanism", "locationRef"], "observation.source");
  c.assertRef(input.source.collectorId, "observation.source.collectorId");
  c.assertSemver(input.source.version, "observation.source.version");
  c.assertEnum(input.source.mechanism, ["test", "schema", "static-analysis", "manifest", "manual", "runtime"], "observation.source.mechanism");
  const source = { collectorId: input.source.collectorId, version: input.source.version, mechanism: input.source.mechanism };
  if (input.source.locationRef !== undefined) {
    c.assertRepoRelativePath(input.source.locationRef, "observation.source.locationRef");
    source.locationRef = input.source.locationRef;
  }

  assertRevision(input.revision, "observation.revision");
  c.assertSha256(input.scopeHash, "observation.scopeHash");
  c.assertSha256(input.configHash, "observation.configHash");
  c.assertSha256(input.catalogDigest, "observation.catalogDigest");
  c.assertIso(input.observedAt, "observation.observedAt");
  c.assertEnum(input.status, OBSERVATION_STATUSES, "observation.status");
  c.assertEnum(input.confidence, c.CONFIDENCES, "observation.confidence");
  c.assertEnum(input.evidenceClass, c.EVIDENCE_CLASSES, "observation.evidenceClass");
  c.assertObject(input.facts, "observation.facts");
  c.assertNoForbiddenFieldsDeep(input.facts, "observation.facts");

  const limitations = input.limitations === undefined ? [] : input.limitations;
  c.assertArray(limitations, "observation.limitations");
  const limits = limitations.map((d, i) => c.createDiagnostic(d, `observation.limitations[${i}]`));

  c.assertNonNegativeInt(input.durationMs, "observation.durationMs");
  c.assertEnum(input.cache, c.CACHE_STATUSES, "observation.cache");

  // Invariantes de honestidad.
  if (input.status !== OBSERVATION_STATUS.COMPLETE && limits.length === 0) {
    c.fail(`observation con status '${input.status}' requiere al menos una limitación explicando la causa (R6.3)`);
  }
  if (input.confidence === c.CONFIDENCE.DETERMINISTIC && input.status !== OBSERVATION_STATUS.COMPLETE) {
    c.fail("observation parcial/fallida no puede declarar confianza determinista");
  }
  if (input.evidenceClass === c.EVIDENCE_CLASS.HEURISTIC && input.confidence === c.CONFIDENCE.DETERMINISTIC) {
    c.fail("evidencia heurística no puede declarar confianza determinista (heurística domina)", "HEURISTIC_DETERMINISTIC");
  }
  if (input.source.mechanism === "static-analysis" && input.evidenceClass === c.EVIDENCE_CLASS.MANUAL) {
    c.fail("static-analysis no puede declararse evidencia manual");
  }
  if (input.source.mechanism === "manual" && input.evidenceClass !== c.EVIDENCE_CLASS.MANUAL) {
    c.fail("una revisión manual debe declararse evidenceClass 'manual' (R7.6)");
  }

  return c.deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    observationId: input.observationId,
    kind: input.kind,
    controlId: input.controlId,
    unitId: input.unitId,
    source,
    revision: input.revision,
    scopeHash: input.scopeHash,
    configHash: input.configHash,
    catalogDigest: input.catalogDigest,
    observedAt: input.observedAt,
    status: input.status,
    confidence: input.confidence,
    evidenceClass: input.evidenceClass,
    facts: c.cloneJson(input.facts, "observation.facts"),
    limitations: limits,
    durationMs: input.durationMs,
    cache: input.cache,
  });
}

module.exports = {
  SCHEMA_VERSION,
  OBSERVATION_STATUS,
  OBSERVATION_STATUSES,
  REVISION_RE,
  DECISION_FIELDS,
  assertRevision,
  createObservation,
};
