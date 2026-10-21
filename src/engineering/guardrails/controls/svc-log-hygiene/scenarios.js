"use strict";

/** Escenarios de `svc.log-hygiene` (T38.2). Datos personales y secretos canario. */

const MAX_ENDPOINTS = 5;
const SCENARIOS = ["structured", "correlation", "no-pii", "error"];
const requiredScenarios = (facts) => facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => SCENARIOS.map((s) => `${s}@${e.id}`));

function expectationsFor(id) {
  return {
    structured: [{ logged: true, structured: true }],
    correlation: [{ propagated: true, generated: true }],
    "no-pii": [{ noEmail: true, noPhone: true, noCard: true, noToken: true, noPassword: true }],
    error: [{ errorLogged: true, noSecrets: true, noPii: true }],
  }[id.split("@")[0]] || [];
}

const RULES = {
  logged: "structured-logs",
  structured: "structured-logs",
  propagated: "correlation-propagated",
  generated: "correlation-generated",
  noEmail: "pii-in-logs",
  noPhone: "pii-in-logs",
  noCard: "pii-in-logs",
  noToken: "secret-in-logs",
  noPassword: "secret-in-logs",
  errorLogged: "error-logged",
  noSecrets: "secret-in-logs",
  noPii: "pii-in-logs",
};
const ruleFor = (id, fact) => RULES[fact] || "structured-logs";

module.exports = { MAX_ENDPOINTS, SCENARIOS, requiredScenarios, expectationsFor, ruleFor };
