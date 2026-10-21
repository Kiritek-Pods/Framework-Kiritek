"use strict";

/**
 * Normalización de observaciones (T06.3).
 *
 * Cada salida cruda se convierte en `Observation` validada con identidad de
 * la ejecución (revisión, scope/config/catalog hashes), procedencia del
 * collector, confianza y limitaciones. Lo que no cumple el contrato no se
 * descarta: queda como observación `invalid` con la causa. Entradas de cache
 * con otra identidad quedan `invalid` (IDENTITY_MISMATCH) y nunca sustentan
 * una decisión. El orden de collectors no altera el resultado.
 */

const { createObservation } = require("../contracts/observation.js");
const { CONFIDENCE, EVIDENCE_CLASS, deepFreeze } = require("../contracts/common.js");
const { COLLECTOR_STATUS } = require("./collect.js");

const RAW_KEYS = ["kind", "status", "confidence", "evidenceClass", "facts", "limitations", "mechanism", "locationRef", "durationMs", "cache", "revision", "scopeHash", "configHash", "catalogDigest", "observedAt"];
const MANUAL_REVIEW_KEYS = ["reviewer", "scope", "checklistRef", "reviewedAt", "expiresAt", "reference"];

function idFor(collectorId, index) {
  return `obs/${collectorId}/${index}`;
}

function failureObservation(identity, collected, index, status, code, message) {
  return createObservation({
    observationId: idFor(collected.collectorId, index),
    kind: "collector-run",
    controlId: identity.controlId,
    unitId: identity.unitId,
    source: { collectorId: collected.collectorId, version: collected.version, mechanism: "runtime" },
    revision: identity.revision,
    scopeHash: identity.scopeHash,
    configHash: identity.configHash,
    catalogDigest: identity.catalogDigest,
    observedAt: identity.observedAt,
    status,
    confidence: CONFIDENCE.UNKNOWN,
    evidenceClass: EVIDENCE_CLASS.HEURISTIC,
    facts: {},
    limitations: [{ code, message }],
    durationMs: collected.durationMs,
    cache: "bypass",
  });
}

function normalizeOne(raw, identity, collected, index, controlNormalizer) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Object.assign(new Error("salida no es objeto"), { code: "NORMALIZATION" });
  for (const k of Object.keys(raw)) {
    if (!RAW_KEYS.includes(k)) throw Object.assign(new Error(`campo ${k}`), { code: ["decision", "severity", "blockingEligible", "allow", "deny"].includes(k) ? "COLLECTOR_DECISION" : "NORMALIZATION" });
  }
  let facts = raw.facts || {};
  if (controlNormalizer) facts = controlNormalizer.normalize(deepFreeze(JSON.parse(JSON.stringify(facts))), raw.kind);
  const mechanism = raw.mechanism || "test";
  if (mechanism === "manual") {
    const review = facts && facts.review;
    if (!review || MANUAL_REVIEW_KEYS.some((k) => typeof review[k] !== "string")) {
      throw Object.assign(new Error("revisión manual incompleta"), { code: "MANUAL_REVIEW_INCOMPLETE" });
    }
  }
  const obs = createObservation({
    observationId: idFor(collected.collectorId, index),
    kind: raw.kind,
    controlId: identity.controlId,
    unitId: identity.unitId,
    source: { collectorId: collected.collectorId, version: collected.version, mechanism, ...(raw.locationRef ? { locationRef: raw.locationRef } : {}) },
    revision: raw.revision || identity.revision,
    scopeHash: raw.scopeHash || identity.scopeHash,
    configHash: raw.configHash || identity.configHash,
    catalogDigest: raw.catalogDigest || identity.catalogDigest,
    observedAt: raw.observedAt || identity.observedAt,
    status: raw.status || "complete",
    confidence: raw.confidence,
    evidenceClass: raw.evidenceClass,
    facts,
    limitations: raw.limitations || [],
    durationMs: raw.durationMs !== undefined ? raw.durationMs : collected.durationMs,
    cache: raw.cache || "miss",
  });
  const mismatched = ["revision", "scopeHash", "configHash", "catalogDigest"].filter((k) => obs[k] !== identity[k]);
  if (mismatched.length) {
    throw Object.assign(new Error(mismatched.join(",")), { code: "IDENTITY_MISMATCH", fields: mismatched });
  }
  return obs;
}

/**
 * @param {object[]} collected   Salida de `runCollectors`.
 * @param {object} identity      { controlId, unitId, revision, scopeHash, configHash, catalogDigest, observedAt }
 * @param {object} opts          { controlNormalizer?, maxAgeSeconds, nowMs }
 * @returns {{observations: object[], staleIds: string[], normalizerVersion: string|null}}
 */
function normalizeObservations(collected, identity, opts = {}) {
  const observations = [];
  const staleIds = [];
  for (const c of collected) {
    if (c.status === COLLECTOR_STATUS.TIMEOUT) {
      observations.push(failureObservation(identity, c, 0, "timeout", "TIMEOUT", `collector ${c.collectorId} excedió el presupuesto`));
      continue;
    }
    if (c.status === COLLECTOR_STATUS.ERROR) {
      observations.push(failureObservation(identity, c, 0, "unavailable", "COLLECTOR_UNAVAILABLE", `collector ${c.collectorId} falló (${c.errorCode})`));
      continue;
    }
    if (c.raw.length === 0) {
      observations.push(failureObservation(identity, c, 0, "unavailable", "COLLECTOR_EMPTY", `collector ${c.collectorId} no produjo observaciones`));
      continue;
    }
    c.raw.forEach((raw, i) => {
      try {
        const obs = normalizeOne(raw, identity, c, i, opts.controlNormalizer);
        observations.push(obs);
        const age = (opts.nowMs || Date.now)() - Date.parse(obs.observedAt);
        if (opts.maxAgeSeconds !== undefined && age > opts.maxAgeSeconds * 1000) staleIds.push(obs.observationId);
      } catch (err) {
        const code = err && /^[A-Z_]+$/.test(err.code || "") ? err.code : "NORMALIZATION";
        const msg =
          code === "IDENTITY_MISMATCH"
            ? `observación de otra identidad (${err.fields.join(", ")}): no sustenta decisiones`
            : `salida de ${c.collectorId} no cumple el contrato de observación`;
        observations.push(failureObservation(identity, c, i, "invalid", code, msg));
      }
    });
  }
  observations.sort((a, b) => (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0));
  return { observations, staleIds: staleIds.sort() };
}

module.exports = { normalizeObservations };
