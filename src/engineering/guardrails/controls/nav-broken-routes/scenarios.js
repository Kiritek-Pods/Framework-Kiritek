"use strict";

/**
 * Escenarios de `nav.broken-routes` (T30.2). URLs sintéticas armadas desde
 * las rutas del contrato (cada `:param` se reemplaza por un valor opaco).
 */

const PARAM_VALUE = "k123";
const UNKNOWN = "/kiritek-ruta-inexistente/zz9";
const MALFORMED = "/%E0%A4%A/%%zz";

const concrete = (path) => path.replace(/:[a-zA-Z][a-zA-Z0-9]*/g, PARAM_VALUE);
const publicRoute = (facts) => facts.routes.find((r) => !r.auth);
const authRoute = (facts) => facts.routes.find((r) => r.auth);

function scenarioIds(facts) {
  return [publicRoute(facts) && "known", "unknown", "malformed", facts.deepLinks === "required" && authRoute(facts) && "deep-auth"].filter(Boolean);
}

const requiredScenarios = (facts) => scenarioIds(facts);

function expectationsFor(id) {
  return {
    known: [{ threw: false, state: "ok", routeOk: true }],
    unknown: [{ threw: false, state: "not-found", exitLink: true }],
    malformed: [{ threw: false, state: ["not-found", "ok"] }],
    "deep-auth": [{ state: "login" }, { returned: true, queryKept: true }],
  }[id] || [];
}

const RULES = {
  known: { routeOk: "route-match", default: "route-match" },
  unknown: { exitLink: "exit-link", default: "not-found-page" },
  malformed: { default: "malformed-url" },
  "deep-auth": { state: "auth-redirect", queryKept: "keep-query", default: "return-after-login" },
};
function ruleFor(id, fact) {
  const r = RULES[id] || {};
  return r[fact] || r.default;
}

module.exports = { PARAM_VALUE, UNKNOWN, MALFORMED, concrete, publicRoute, authRoute, scenarioIds, requiredScenarios, expectationsFor, ruleFor };
