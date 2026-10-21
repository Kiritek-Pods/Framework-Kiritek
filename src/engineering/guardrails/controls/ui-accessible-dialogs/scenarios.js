"use strict";

/**
 * Escenarios de `ui.accessible-dialogs` (T31.2), según WAI-ARIA APG: foco al
 * abrir, foco atrapado (modal/panel), Escape y clic afuera, retorno del foco,
 * rol/nombre y fondo inerte.
 */

const MAX_DIALOGS = 5;
const blocking = (d) => d.kind !== "menu";

function scenariosFor(d) {
  return ["focus-in", blocking(d) && "focus-trap", "escape", "outside-click", "semantics", blocking(d) && "inert-background"].filter(Boolean);
}

const split = (id) => {
  const [scenario, dialog] = id.split("@");
  return { scenario, dialog };
};

const requiredScenarios = (facts) => facts.dialogs.slice(0, MAX_DIALOGS).flatMap((d) => scenariosFor(d).map((s) => `${s}@${d.id}`));

function expectationsFor(id, params) {
  const { scenario, dialog } = split(id);
  const d = (params.dialogs || []).find((x) => x.id === dialog) || {};
  switch (scenario) {
    case "focus-in":
      return [{ opened: true, focusIn: true }];
    case "focus-trap":
      return [{ trapped: true }];
    case "escape":
      return d.dismissible || d.kind === "menu" ? [{ closed: true, focusReturned: true }] : [{ closed: false }];
    case "outside-click":
      return d.dismissible || d.kind === "menu" ? [{ closed: true }] : [{ closed: false }];
    case "semantics":
      return [{ roleOk: true, labelled: true }];
    case "inert-background":
      return [{ inert: true }];
    default:
      return [];
  }
}

const RULES = {
  "focus-in": { default: "focus-in" },
  "focus-trap": { default: "focus-trap" },
  escape: { focusReturned: "focus-return", default: "escape-close" },
  "outside-click": { default: "outside-click" },
  semantics: { labelled: "accessible-name", default: "role" },
  "inert-background": { default: "background-inert" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_DIALOGS, blocking, scenariosFor, requiredScenarios, expectationsFor, ruleFor, split };
