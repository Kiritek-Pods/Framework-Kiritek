"use strict";

/**
 * Escenarios de `app.device-permissions` (T29.2). La plataforma es
 * sintética: el harness decide si el usuario concede, niega o ya bloqueó.
 */

const MAX_PERMISSIONS = 5;
const SCENARIOS = ["not-on-launch", "rationale", "granted", "denied", "no-reprompt", "blocked"];
const requiredScenarios = (facts) => facts.permissions.slice(0, MAX_PERMISSIONS).flatMap((p) => SCENARIOS.map((s) => `${s}@${p.id}`));
const split = (id) => {
  const [scenario, permission] = id.split("@");
  return { scenario, permission };
};

function expectationsFor(id, params) {
  const { scenario, permission } = split(id);
  const p = (params.permissions || []).find((x) => x.id === permission) || {};
  const fb = p.fallback === "required" ? { fallback: true } : {};
  return {
    "not-on-launch": [{ requests: 0 }],
    rationale: [{ rationaleFirst: true }],
    granted: [{ requests: 1, worked: true, screen: "app" }],
    denied: [{ settled: true, requests: 1, screen: "app", ...fb }],
    "no-reprompt": [{ settled: true, requests: 1, screen: "app" }],
    blocked: [{ settled: true, requests: 0, settingsLink: true, screen: "app", ...fb }],
  }[scenario] || [];
}

const RULES = {
  "not-on-launch": { default: "ask-in-context" },
  rationale: { default: "rationale" },
  granted: { default: "granted-flow" },
  denied: { fallback: "denied-fallback", default: "denied-keeps-working" },
  "no-reprompt": { default: "no-reprompt" },
  blocked: { settingsLink: "settings-link", fallback: "denied-fallback", requests: "no-reprompt", default: "denied-keeps-working" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_PERMISSIONS, SCENARIOS, requiredScenarios, expectationsFor, ruleFor, split };
