"use strict";

/**
 * Harness conductual de estados de pantalla (T18.2). Reloj virtual y
 * transporte inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su pantalla real):
 *
 *   createScreenUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,  // { load(request) → Promise<{ items: object[] }> } (rechaza ante error)
 *     screen,     // { id, timeoutMs } del contrato
 *   }) → { mount(), view() → Snapshot, retry() }
 *
 *   Snapshot: { state: "loading"|"content"|"empty"|"error", items: number,
 *               retry: boolean,  // acción de reintento visible
 *               busy: boolean }  // carga anunciada (aria-busy, live region…)
 *
 * La traza sólo lleva hechos derivados; los ítems son opacos y sintéticos.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { scenariosFor, planFor, MAX_SCREENS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-data-states-harness", version: "1.0.0" };
const STATES = ["loading", "content", "empty", "error"];
const SNAPSHOT_KEYS = ["state", "items", "retry", "busy"];
const T0 = Date.UTC(2026, 5, 1);

function derive(snap, requests) {
  if (!snap || typeof snap !== "object") return { state: "blank", requests };
  const out = {
    state: STATES.includes(snap.state) ? snap.state : "other",
    items: Number.isInteger(snap.items) && snap.items >= 0 ? Math.min(snap.items, 100000) : 0,
    retry: snap.retry === true,
    busy: snap.busy === true,
    requests,
  };
  const dropped = Object.keys(snap).filter((k) => !SNAPSHOT_KEYS.includes(k)).length;
  if (dropped) out.droppedFields = dropped;
  return out;
}

async function runScenario(screen, scenario, factory) {
  const id = `${scenario}@${screen.id}`;
  const clock = createVirtualClock(T0);
  const plan = planFor(scenario);
  let requests = 0;
  const transport = {
    load() {
      const r = plan[Math.min(requests, plan.length - 1)];
      requests += 1;
      const items = Array.from({ length: r.items || 0 }, (_, i) => ({ id: `item-${i + 1}` }));
      return deferred(clock, { afterMs: r.afterMs, value: { items }, error: r.error ? Object.assign(new Error("synthetic"), { code: "SYNTHETIC" }) : null, hang: r.hang });
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, screen: { id: screen.id, timeoutMs: screen.timeoutMs } });
    if (!sut || typeof sut.mount !== "function" || typeof sut.view !== "function") throw new Error("sin mount()/view()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const view = () => {
    try {
      return derive(sut.view(), requests);
    } catch (_) {
      return derive(null, requests);
    }
  };
  const fire = (fn) => {
    try {
      Promise.resolve(fn()).catch(() => {});
    } catch (_) {
      /* una pantalla que lanza queda en blanco: hecho observado */
    }
  };
  const at = (ms) => advanceTo(clock, T0 + ms);
  const steps = [];
  try {
    fire(() => sut.mount());
    if (scenario === "loading") {
      await at(50);
      steps.push(view());
      await at(2600);
      steps.push(view());
    } else if (scenario === "retry") {
      await at(500);
      steps.push(view());
      fire(() => (typeof sut.retry === "function" ? sut.retry() : undefined));
      await at(1000);
      steps.push(view());
    } else if (scenario === "timeout") {
      await at(screen.timeoutMs + 1000);
      steps.push(view());
    } else {
      await at(500);
      steps.push(view());
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const screen of (params.screens || []).slice(0, MAX_SCREENS)) {
    for (const s of scenariosFor(screen)) scenarios.push(await runScenario(screen, s, factory));
  }
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, derive };
