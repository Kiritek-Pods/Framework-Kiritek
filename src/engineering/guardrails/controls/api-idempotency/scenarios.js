"use strict";

/** Escenarios de `api.idempotency` (T32.2). Claves y cuerpos sintéticos. */

const MAX_ENDPOINTS = 5;
const scenariosFor = (e) => ["replay", "concurrent", "distinct-keys", "key-mismatch", e.requireKey && "missing-key"].filter(Boolean);
const split = (id) => {
  const [scenario, endpoint] = id.split("@");
  return { scenario, endpoint };
};
const requiredScenarios = (facts) => facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => scenariosFor(e).map((s) => `${s}@${e.id}`));

function expectationsFor(id) {
  return {
    replay: [{ firstOk: true, effects: 1, sameResponse: true }],
    concurrent: [{ effects: 1, noServerError: true }],
    "distinct-keys": [{ effects: 2, bothOk: true }],
    "key-mismatch": [{ effects: 1, mismatchRejected: true }],
    "missing-key": [{ effects: 0, rejected: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  replay: { sameResponse: "replay-same-response", default: "single-execution" },
  concurrent: { default: "concurrent-single-execution" },
  "distinct-keys": { default: "distinct-keys" },
  "key-mismatch": { default: "key-mismatch" },
  "missing-key": { default: "key-required" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_ENDPOINTS, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
