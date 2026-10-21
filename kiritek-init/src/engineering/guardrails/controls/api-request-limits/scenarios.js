"use strict";

/** Escenarios de `api.request-limits` (T41.2). Cuerpos sintéticos y una dependencia lenta. */

const MAX_ENDPOINTS = 5;
const WITH_BODY = new Set(["POST", "PUT", "PATCH"]);
const scenariosFor = (e) => [...(WITH_BODY.has(e.method) ? ["within", "oversized", "chunked"] : []), "slow", "fast"];
const split = (id) => {
  const [scenario, endpoint] = id.split("@");
  return { scenario, endpoint };
};
const requiredScenarios = (facts) => facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => scenariosFor(e).map((s) => `${s}@${e.id}`));

function expectationsFor(id) {
  return {
    within: [{ accepted: true }],
    oversized: [{ rejected: true, is413: true, notProcessed: true }],
    chunked: [{ rejected: true, notProcessed: true }],
    slow: [{ responded: true, timeoutStatus: true, cancelled: true }],
    fast: [{ ok: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  within: { default: "false-rejection" },
  oversized: { rejected: "body-limit", is413: "body-limit-status", notProcessed: "processed-oversized" },
  chunked: { rejected: "body-limit-unverified", notProcessed: "processed-oversized" },
  slow: { responded: "request-timeout", timeoutStatus: "timeout-status", cancelled: "cancel-on-timeout" },
  fast: { default: "premature-timeout" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_ENDPOINTS, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
