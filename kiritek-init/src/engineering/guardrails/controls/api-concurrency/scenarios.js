"use strict";

/** Escenarios de `api.concurrency` (T39.2). Un recurso sintético por escenario. */

const MAX_RESOURCES = 5;
const scenariosFor = (r) => ["exposed", "conditional", "stale", r.requirePrecondition && "precondition", "race"].filter(Boolean);
const split = (id) => {
  const [scenario, resource] = id.split("@");
  return { scenario, resource };
};
const requiredScenarios = (facts) => facts.resources.slice(0, MAX_RESOURCES).flatMap((r) => scenariosFor(r).map((s) => `${s}@${r.id}`));

function expectationsFor(id) {
  return {
    exposed: [{ ok: true, versionExposed: true }],
    conditional: [{ applied: true, advances: true }],
    stale: [{ rejected: true, notOverwritten: true }],
    precondition: [{ required: true }],
    race: [{ oneWins: true, loserRejected: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  exposed: { default: "version-exposed" },
  conditional: { applied: "conditional-update", advances: "version-advances" },
  stale: { rejected: "stale-rejected", notOverwritten: "lost-update" },
  precondition: { default: "precondition-required" },
  race: { default: "atomic-check" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_RESOURCES, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
