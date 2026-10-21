"use strict";

/** Escenarios de `svc.dependency-failure` (T36.2): la dependencia responde, se cuelga o falla. */

const MAX_DEPS = 5;
const BREAKER_REQUESTS = 20;
const scenariosFor = (d) => ["healthy", "hang", "error", d.circuitBreaker === "required" && "breaker"].filter(Boolean);
const split = (id) => {
  const [scenario, dep] = id.split("@");
  return { scenario, dep };
};
const requiredScenarios = (facts) => facts.dependencies.slice(0, MAX_DEPS).flatMap((d) => scenariosFor(d).map((s) => `${s}@${d.id}`));

function expectationsFor(id) {
  return {
    healthy: [{ ok: true }],
    hang: [{ settled: true, statusOk: true }],
    error: [{ settled: true, statusOk: true }],
    breaker: [{ opened: true, recovered: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  healthy: { default: "healthy-path" },
  hang: { settled: "dependency-timeout", default: "failure-response" },
  error: { settled: "dependency-timeout", default: "failure-response" },
  breaker: { recovered: "breaker-recovery", default: "circuit-breaker" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_DEPS, BREAKER_REQUESTS, scenariosFor, requiredScenarios, expectationsFor, ruleFor, split };
