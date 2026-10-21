"use strict";

/** Escenarios de `api.long-operations` (T44.2). Trabajo sintético que termina, falla o se cuelga. */

const MAX_OPERATIONS = 5;
const SCENARIOS = ["accepted", "completes", "fails", "stuck", "unknown"];
const split = (id) => {
  const [scenario, operation] = id.split("@");
  return { scenario, operation };
};
const requiredScenarios = (facts) => facts.operations.slice(0, MAX_OPERATIONS).flatMap((o) => SCENARIOS.map((s) => `${s}@${o.id}`));

function expectationsFor(id) {
  return {
    accepted: [{ accepted: true, quick: true, located: true }],
    completes: [{ completed: true }],
    fails: [{ failedReported: true, noLeak: true }],
    stuck: [{ timedOut: true, cancelled: true }],
    unknown: [{ notFound: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  accepted: { accepted: "not-async", quick: "not-async", located: "status-location" },
  completes: { default: "never-completes" },
  fails: { failedReported: "failure-not-reported", noLeak: "failure-leak" },
  stuck: { timedOut: "stuck-forever", cancelled: "not-cancelled" },
  unknown: { default: "unknown-operation" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_OPERATIONS, SCENARIOS, requiredScenarios, expectationsFor, ruleFor };
