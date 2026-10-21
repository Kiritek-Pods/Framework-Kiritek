"use strict";

/**
 * Escenarios de `ui.destructive-actions` (T26.2). El transporte ejecuta (y
 * revierte) la acción sintética y cuenta cuántas veces se aplicó de verdad.
 */

const MAX_ACTIONS = 5;
const confirms = (a) => a.safeguard !== "undo";
const undoes = (a) => a.safeguard !== "confirm";
const windowOf = (a) => (a.undoWindowMs === undefined ? 5000 : a.undoWindowMs);

function scenariosFor(a) {
  return [
    confirms(a) && "confirm-required",
    confirms(a) && "dismiss",
    "execute",
    "double-execute",
    undoes(a) && "undo",
    undoes(a) && "undo-expired",
    "failure",
  ].filter(Boolean);
}

const split = (id) => {
  const [scenario, action] = id.split("@");
  return { scenario, action };
};

const requiredScenarios = (facts) => facts.actions.slice(0, MAX_ACTIONS).flatMap((a) => scenariosFor(a).map((s) => `${s}@${a.id}`));

function expectationsFor(id) {
  return {
    "confirm-required": [{ dialog: true, executions: 0 }],
    dismiss: [{ executions: 0, state: ["cancelled", "idle"] }],
    execute: [{ effective: 1, state: "done", message: "ok" }],
    "double-execute": [{ executions: 1 }],
    undo: [{ effective: 0, state: "undone" }],
    "undo-expired": [{ effective: 1, state: "done" }],
    failure: [{ effective: 0, state: "error", message: "ok" }],
  }[split(id).scenario] || [];
}

const RULES = {
  "confirm-required": { default: "confirmation" },
  dismiss: { default: "dismiss" },
  execute: { message: "message-text", default: "execute" },
  "double-execute": { default: "double-execution" },
  undo: { default: "undo" },
  "undo-expired": { default: "undo-window" },
  failure: { message: "message-text", default: "error-state" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_ACTIONS, confirms, undoes, windowOf, scenariosFor, requiredScenarios, expectationsFor, ruleFor, split };
