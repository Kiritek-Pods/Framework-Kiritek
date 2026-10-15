"use strict";

/**
 * Harness conductual de diálogos (T31.2). Framework-neutral: el adapter
 * expone el estado accesible del componente real (rol, nombre, foco).
 *
 * Interfaz del adapter:
 *
 *   createDialogUnderTest({ dialog }) → {
 *     open(),                       // activa el botón que lo abre (foco en el botón)
 *     press(key),                   // "Tab" | "Shift+Tab" | "Escape"
 *     clickOutside(),
 *     view() → { open, role, labelled, modal, focus, controls, backgroundInert }
 *   }
 *
 *   focus: "dialog" | "control:<id>" | "trigger" | "background:<id>" | …
 *   controls: ids de los elementos enfocables del diálogo.
 */

const { scenariosFor, MAX_DIALOGS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-dialogs-harness", version: "1.0.0" };
const ROLES = { modal: ["dialog", "alertdialog"], drawer: ["dialog"], menu: ["menu", "listbox"] };

const inside = (focus) => typeof focus === "string" && (focus === "dialog" || focus.startsWith("control:"));

function runScenario(d, scenario, factory) {
  const id = `${scenario}@${d.id}`;
  let sut;
  try {
    sut = factory({ dialog: { ...d } });
    if (!sut || ["open", "press", "view"].some((m) => typeof sut[m] !== "function")) throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const view = () => {
    try {
      const v = sut.view();
      return v && typeof v === "object" ? v : {};
    } catch (_) {
      return {};
    }
  };
  const act = (fn) => {
    try {
      fn();
    } catch (_) {
      /* el componente que lanza no reacciona: hecho observado */
    }
  };
  act(() => sut.open());
  const opened = view();
  let step;
  if (scenario === "focus-in") step = { opened: opened.open === true, focusIn: inside(opened.focus) };
  else if (scenario === "focus-trap") {
    const n = (Array.isArray(opened.controls) ? opened.controls.length : 0) + 2;
    let trapped = opened.open === true && inside(opened.focus);
    for (let i = 0; i < n && trapped; i += 1) {
      act(() => sut.press("Tab"));
      trapped = inside(view().focus);
    }
    for (let i = 0; i < n && trapped; i += 1) {
      act(() => sut.press("Shift+Tab"));
      trapped = inside(view().focus);
    }
    step = { trapped };
  } else if (scenario === "escape") {
    act(() => sut.press("Escape"));
    const v = view();
    step = { closed: v.open !== true, focusReturned: v.open !== true && v.focus === "trigger" };
  } else if (scenario === "outside-click") {
    act(() => (typeof sut.clickOutside === "function" ? sut.clickOutside() : undefined));
    step = { closed: view().open !== true };
  } else if (scenario === "semantics") {
    const roleOk = (ROLES[d.kind] || []).includes(opened.role) && (d.kind !== "modal" || opened.modal === true);
    step = { roleOk, labelled: opened.labelled === true };
  } else step = { inert: opened.open === true && opened.backgroundInert === true };
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const d of (params.dialogs || []).slice(0, MAX_DIALOGS)) for (const s of scenariosFor(d)) scenarios.push(runScenario(d, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
