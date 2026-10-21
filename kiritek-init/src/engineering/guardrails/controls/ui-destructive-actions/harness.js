"use strict";

/**
 * Harness conductual de acciones destructivas (T26.2). Reloj y transporte
 * inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su botón/flujo real):
 *
 *   createActionUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,  // { execute({ action }) → Promise, revert({ action }) → Promise }
 *     action,     // { id, safeguard, undoWindowMs } del contrato
 *   }) → { request(), confirm(), dismiss(), undo(), view() → { dialog, status, message } }
 *
 *   status: "idle"|"pending"|"done"|"undone"|"cancelled"|"error".
 *   Deshacer puede implementarse demorando execute hasta que vence la
 *   ventana o ejecutando y luego llamando a revert: se mide el efecto neto.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { messageState } = require("../shared/message-state.js");
const { scenariosFor, confirms, windowOf, MAX_ACTIONS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-destructive-harness", version: "1.0.0" };
const STATES = ["idle", "pending", "done", "undone", "cancelled", "error"];
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(a, scenario, factory) {
  const id = `${scenario}@${a.id}`;
  const clock = createVirtualClock(T0);
  let executions = 0;
  let reverts = 0;
  const transport = {
    execute() {
      executions += 1;
      return deferred(clock, { afterMs: 100, value: { ok: true }, error: scenario === "failure" ? Object.assign(new Error("synthetic"), { code: "SYNTHETIC" }) : null });
    },
    revert() {
      reverts += 1;
      return deferred(clock, { afterMs: 100, value: { ok: true } });
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, action: { ...a } });
    if (!sut || ["request", "view"].some((m) => typeof sut[m] !== "function")) throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const fire = (name) => {
    try {
      if (typeof sut[name] === "function") Promise.resolve(sut[name]()).catch(() => {});
    } catch (_) {
      /* el flujo que lanza no avanza: hecho observado */
    }
  };
  const view = () => {
    try {
      const v = sut.view();
      return v && typeof v === "object" ? v : {};
    } catch (_) {
      return {};
    }
  };
  let t = 0;
  const wait = (ms) => advanceTo(clock, T0 + (t += ms));
  const win = windowOf(a);
  const go = () => {
    fire("request");
    if (confirms(a)) fire("confirm");
  };
  const failed = scenario === "failure";
  const effective = () => (failed ? 0 : executions - reverts);
  try {
    if (scenario === "confirm-required") {
      fire("request");
      await wait(100);
      const v = view();
      return { id, status: "ok", steps: [{ executions, dialog: v.dialog === true }] };
    }
    if (scenario === "dismiss") {
      fire("request");
      await wait(50);
      fire("dismiss");
      await wait(win + 2000);
    } else if (scenario === "double-execute") {
      fire("request");
      if (confirms(a)) {
        fire("confirm");
        fire("confirm");
      } else fire("request");
      await wait(win + 2000);
    } else if (scenario === "undo") {
      go();
      await wait(Math.max(1, Math.floor(win / 2)));
      fire("undo");
      await wait(win + 2000);
    } else {
      go();
      await wait(win + 2000);
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  const v = view();
  return { id, status: "ok", steps: [{ executions, effective: effective(), state: STATES.includes(v.status) ? v.status : "other", message: messageState(v.message) }] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const a of (params.actions || []).slice(0, MAX_ACTIONS)) for (const s of scenariosFor(a)) scenarios.push(await runScenario(a, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
