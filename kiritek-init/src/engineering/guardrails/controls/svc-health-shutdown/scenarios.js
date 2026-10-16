"use strict";

/** Escenarios de `svc.health-shutdown` (T37.2). */

const scenarioIds = (facts) => ["live", "ready", ...facts.dependencies.slice(0, 5).map((d) => `not-ready@${d}`), "drain", "grace-bound"];
const requiredScenarios = (facts) => scenarioIds(facts);

function expectationsFor(id) {
  if (id.startsWith("not-ready@")) return [{ readinessDown: true, stillLive: true }];
  return {
    live: [{ live: true }],
    ready: [{ ready: true }],
    drain: [{ inFlightCompleted: true, readinessDown: true, newRejected: true, shutdownSettled: true }],
    "grace-bound": [{ shutdownBounded: true }],
  }[id] || [];
}

const RULES = {
  live: { default: "liveness" },
  ready: { default: "readiness" },
  "not-ready": { readinessDown: "readiness-checks-deps", stillLive: "liveness-independent" },
  drain: { inFlightCompleted: "drain-in-flight", readinessDown: "not-ready-on-shutdown", newRejected: "reject-new-work", shutdownSettled: "shutdown-completes" },
  "grace-bound": { default: "grace-period" },
};
function ruleFor(id, fact) {
  const r = RULES[id.split("@")[0]] || {};
  return r[fact] || r.default;
}

module.exports = { scenarioIds, requiredScenarios, expectationsFor, ruleFor };
