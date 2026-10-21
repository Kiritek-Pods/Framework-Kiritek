"use strict";

/** Escenarios de `svc.startup-config` (T49.2). Entornos sintéticos. */

const MAX_VARIABLES = 30;
const VALIDATED = new Set(["url", "int", "enum", "bool"]);
const slug = (name) => `v-${name.toLowerCase().replace(/_/g, "-")}`;

function scenarioIds(facts) {
  const vars = facts.variables.slice(0, MAX_VARIABLES);
  return [
    "valid",
    ...vars.filter((v) => v.required).map((v) => `missing@${slug(v.name)}`),
    ...vars.filter((v) => VALIDATED.has(v.kind)).map((v) => `invalid@${slug(v.name)}`),
    ...vars.filter((v) => !v.required).map((v) => `optional@${slug(v.name)}`),
    vars.some((v) => v.kind === "secret") && vars.some((v) => v.kind !== "secret" && (v.required || VALIDATED.has(v.kind))) && "secrets",
  ].filter(Boolean);
}
const requiredScenarios = (facts) => scenarioIds(facts);

function expectationsFor(id) {
  return {
    valid: [{ started: true }],
    missing: [{ refused: true, namesVariable: true }],
    invalid: [{ refused: true, namesVariable: true }],
    optional: [{ started: true }],
    secrets: [{ noSecret: true }],
  }[id.split("@")[0]] || [];
}

const RULES = {
  valid: { default: "valid-config-rejected" },
  missing: { refused: "missing-not-detected", namesVariable: "unhelpful-error" },
  invalid: { refused: "invalid-not-detected", namesVariable: "unhelpful-error" },
  optional: { default: "optional-required" },
  secrets: { default: "secret-in-config-error" },
};
function ruleFor(id, fact) {
  const r = RULES[id.split("@")[0]] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_VARIABLES, VALIDATED, slug, scenarioIds, requiredScenarios, expectationsFor, ruleFor };
