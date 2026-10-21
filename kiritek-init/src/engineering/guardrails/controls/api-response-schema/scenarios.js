"use strict";

/** Escenarios de `api.response-schema` (T43.2). */

const MAX_ENDPOINTS = 5;
const scenariosFor = (e, p) => ["success", e.invalidBody && p.errorSchema && "error"].filter(Boolean);
const split = (id) => {
  const [scenario, endpoint] = id.split("@");
  return { scenario, endpoint };
};
const requiredScenarios = (facts) => facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => scenariosFor(e, facts).map((s) => `${s}@${e.id}`));

function expectationsFor(id) {
  return {
    success: [{ statusOk: true, schemaOk: true, noUndeclared: true }],
    error: [{ clientError: true, errorSchemaOk: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  success: { statusOk: "response-status", schemaOk: "schema-mismatch", noUndeclared: "undeclared-field" },
  error: { clientError: "error-status", errorSchemaOk: "error-schema" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || "schema-mismatch";
}

module.exports = { MAX_ENDPOINTS, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
