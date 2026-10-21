"use strict";

/**
 * Applicability: resolución previa a la evaluación (R5).
 * `not_applicable`, `unknown` y `unavailable` nunca significan conformidad
 * y siempre llevan razones.
 */

const c = require("./common.js");

const APPLICABILITY_STATUS = Object.freeze({
  APPLICABLE: "applicable",
  NOT_APPLICABLE: "not_applicable",
  UNKNOWN: "unknown",
  UNAVAILABLE: "unavailable",
});
const APPLICABILITY_STATUSES = Object.freeze(Object.values(APPLICABILITY_STATUS));
const KEYS = ["status", "confidence", "reasons", "sources", "unitId", "controlId", "profileRefs", "moment", "scopeHash"];

function createApplicability(input) {
  c.assertObject(input, "applicability");
  c.assertKnownKeys(input, KEYS, "applicability");

  c.assertEnum(input.status, APPLICABILITY_STATUSES, "applicability.status");
  c.assertEnum(input.confidence, c.CONFIDENCES, "applicability.confidence");
  c.assertArray(input.reasons, "applicability.reasons");
  const reasons = input.reasons.map((d, i) => c.createDiagnostic(d, `applicability.reasons[${i}]`));
  c.assertArray(input.sources, "applicability.sources");
  input.sources.forEach((s, i) => c.assertRef(s, `applicability.sources[${i}]`));
  c.assertNamespacedId(input.unitId, "applicability.unitId");
  c.assertControlId(input.controlId, "applicability.controlId");
  c.assertArray(input.profileRefs, "applicability.profileRefs");
  const profileRefs = input.profileRefs.map((r, i) => c.createProfileRef(r, `applicability.profileRefs[${i}]`));
  c.assertEnum(input.moment, c.MOMENTS, "applicability.moment");
  c.assertSha256(input.scopeHash, "applicability.scopeHash");

  if (input.status !== APPLICABILITY_STATUS.APPLICABLE && reasons.length === 0) {
    c.fail(`applicability '${input.status}' requiere razones (R5.2)`);
  }
  if (input.status === APPLICABILITY_STATUS.UNKNOWN && input.confidence !== c.CONFIDENCE.UNKNOWN) {
    c.fail("applicability 'unknown' sólo admite confianza 'unknown'");
  }
  if (input.status === APPLICABILITY_STATUS.APPLICABLE && profileRefs.length === 0) {
    c.fail("applicability 'applicable' requiere perfiles explícitos que la justifiquen (R5.3)");
  }

  return c.deepFreeze({
    status: input.status,
    confidence: input.confidence,
    reasons,
    sources: [...input.sources],
    unitId: input.unitId,
    controlId: input.controlId,
    profileRefs,
    moment: input.moment,
    scopeHash: input.scopeHash,
  });
}

/** Aplicable sin ambigüedad: único estado que permite evaluar (design §8). */
function isUnambiguouslyApplicable(applicability) {
  return (
    !!applicability &&
    applicability.status === APPLICABILITY_STATUS.APPLICABLE &&
    applicability.confidence !== c.CONFIDENCE.UNKNOWN
  );
}

module.exports = { APPLICABILITY_STATUS, APPLICABILITY_STATUSES, createApplicability, isUnambiguouslyApplicable };
