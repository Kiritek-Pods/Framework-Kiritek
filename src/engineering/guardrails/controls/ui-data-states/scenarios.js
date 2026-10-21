"use strict";

/**
 * Escenarios de `ui.data-states` (T18.2). Datos sintéticos: el transporte
 * del harness responde con N ítems opacos, vacío, error o nunca.
 */

const SCENARIOS = ["loading", "content", "empty", "error", "retry", "timeout", "single-request"];
const MAX_SCREENS = 5;

/** Escenarios exigidos por pantalla según el contrato. */
function scenariosFor(screen) {
  return SCENARIOS.filter((s) => s !== "retry" || screen.retry === "required");
}

const split = (id) => {
  const [scenario, screen] = id.split("@");
  return { scenario, screen };
};

function requiredScenarios(facts) {
  return facts.screens.slice(0, MAX_SCREENS).flatMap((s) => scenariosFor(s).map((x) => `${x}@${s.id}`));
}

/** Plan de respuestas del transporte por escenario (la última se repite). */
function planFor(scenario) {
  return {
    loading: [{ afterMs: 2000, items: 3 }],
    content: [{ afterMs: 100, items: 3 }],
    empty: [{ afterMs: 100, items: 0 }],
    error: [{ afterMs: 100, error: true }],
    retry: [{ afterMs: 100, error: true }, { afterMs: 100, items: 2 }],
    timeout: [{ hang: true }],
    "single-request": [{ afterMs: 100, items: 1 }],
  }[scenario];
}

function expectationsFor(id, params) {
  const { scenario, screen: screenId } = split(id);
  const screen = (params.screens || []).find((s) => s.id === screenId) || {};
  switch (scenario) {
    case "loading":
      return [{ state: "loading", busy: true }, { state: "content" }];
    case "content":
      return [{ state: "content", items: 3 }];
    case "empty":
      return [{ state: screen.emptyState === "required" ? "empty" : ["empty", "content"] }];
    case "error":
      return [screen.retry === "required" ? { state: "error", retry: true } : { state: "error" }];
    case "retry":
      return [{ state: "error" }, { state: "content", items: 2 }];
    case "timeout":
      return [{ state: "error" }];
    case "single-request":
      return [{ state: "content", requests: 1 }];
    default:
      return [];
  }
}

const RULES = {
  loading: { busy: "loading-announced", default: "loading-state" },
  content: { default: "content-state" },
  empty: { default: "empty-state" },
  error: { retry: "retry-available", default: "error-state" },
  retry: { default: "retry" },
  timeout: { default: "timeout" },
  "single-request": { requests: "duplicate-request", default: "content-state" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { SCENARIOS, MAX_SCREENS, scenariosFor, requiredScenarios, planFor, expectationsFor, ruleFor, split };
