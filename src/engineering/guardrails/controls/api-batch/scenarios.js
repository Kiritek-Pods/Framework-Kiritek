"use strict";

/** Escenarios de `api.batch` (T45.2). Lotes sintéticos de tres ítems. */

const MAX_ENDPOINTS = 5;
const SCENARIOS = ["all-ok", "invalid-item", "apply-failure", "over-limit", "empty"];
const split = (id) => {
  const [scenario, endpoint] = id.split("@");
  return { scenario, endpoint };
};
const requiredScenarios = (facts) => facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => SCENARIOS.map((s) => `${s}@${e.id}`));
const modeOf = (id, params) => ((params.endpoints || []).find((e) => e.id === split(id).endpoint) || {}).mode;

function expectationsFor(id, params = {}) {
  const atomic = modeOf(id, params) === "atomic";
  const mixed = atomic ? { reported: true, nothingApplied: true } : { reported: true, othersApplied: true };
  return {
    "all-ok": [{ ok: true, complete: true, ordered: true, persisted: true }],
    "invalid-item": [mixed],
    "apply-failure": [mixed],
    "over-limit": [{ rejected: true, nothingApplied: true }],
    empty: [{ noServerError: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  "all-ok": { ok: "batch-results", complete: "batch-results", ordered: "batch-results", persisted: "batch-not-applied" },
  "invalid-item": { reported: "silent-failure", othersApplied: "partial-lost", nothingApplied: "not-atomic" },
  "apply-failure": { reported: "silent-failure", othersApplied: "partial-lost", nothingApplied: "not-atomic" },
  "over-limit": { default: "batch-limit" },
  empty: { default: "empty-batch" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_ENDPOINTS, SCENARIOS, requiredScenarios, expectationsFor, ruleFor };
