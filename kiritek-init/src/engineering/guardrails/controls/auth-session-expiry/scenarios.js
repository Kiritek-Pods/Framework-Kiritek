"use strict";

/**
 * Escenarios de `auth.session-expiry` (T22.2). Tokens sintéticos; el
 * transporte responde 401 a los tokens vencidos.
 */

const WITH_REFRESH = ["valid", "expired-refresh", "concurrent", "refresh-fails", "repeated-401"];
const WITHOUT_REFRESH = ["valid", "no-refresh"];

const scenariosFor = (session) => (session.refresh === "token-refresh" ? WITH_REFRESH : WITHOUT_REFRESH);
const requiredScenarios = (facts) => scenariosFor(facts.session);

function expectationsFor(id, params) {
  const keep = params.session && params.session.preserveWork === "required" ? { draftPreserved: true } : {};
  return {
    valid: [{ ok: true, sends: 1, refreshes: 0, screen: "app" }],
    "expired-refresh": [{ ok: true, sends: 2, refreshes: 1, screen: "app" }],
    concurrent: [{ ok: true, sends: 6, refreshes: 1, screen: "app" }],
    "refresh-fails": [{ settled: true, sends: 1, refreshes: 1, screen: "login", ...keep }],
    "repeated-401": [{ settled: true, sends: 2, refreshes: 1, screen: "login", ...keep }],
    "no-refresh": [{ settled: true, sends: 1, refreshes: 0, screen: "login", ...keep }],
  }[id] || [];
}

const RULES = {
  valid: { default: "authenticated-request" },
  "expired-refresh": { default: "refresh-retry" },
  concurrent: { refreshes: "single-refresh", default: "refresh-retry" },
  "refresh-fails": { screen: "login-redirect", draftPreserved: "preserve-work", default: "no-loop" },
  "repeated-401": { screen: "login-redirect", draftPreserved: "preserve-work", default: "no-loop" },
  "no-refresh": { screen: "login-redirect", draftPreserved: "preserve-work", default: "no-loop" },
};
function ruleFor(id, fact) {
  const r = RULES[id] || {};
  return r[fact] || r.default;
}

module.exports = { scenariosFor, requiredScenarios, expectationsFor, ruleFor };
