"use strict";

/**
 * Harness conductual del cliente de feature flags (T21.2). Reloj virtual y
 * proveedor inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su cliente de flags):
 *
 *   createFlagClientUnderTest({
 *     clock,     // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     provider,  // { fetch() → Promise<{ values: { [key]: value } }> } (puede rechazar o no responder)
 *     flags,     // [{ key, defaultValue }] del registro
 *     client,    // { timeoutMs, refreshSeconds } del registro
 *   }) → { evaluate(key) → value | Promise<value> }
 *
 * La traza sólo lleva la clase del valor resuelto, nunca valores.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { SCENARIOS, UNKNOWN_KEY } = require("./scenarios.js");

const HARNESS = { name: "kiritek-flags-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const same = (a, b) => typeof a === typeof b && a === b;

function classify(state, p, step) {
  if (!state) return "hang";
  if (!state.ok) return "error";
  const v = state.v;
  if (step === "unknown") return v === false || v === null || v === undefined ? "falsy" : "other";
  if (step === "updated" && same(v, p.updatedValue)) return "updated";
  if (same(v, p.providerValue)) return "provider";
  if (same(v, p.flag.defaultValue)) return "default";
  return "other";
}

async function runScenario(id, factory, p) {
  const clock = createVirtualClock(T0);
  const mode = { "provider-down": "down", "provider-timeout": "hang", "invalid-value": "garbage" }[id] || "ok";
  let value = p.providerValue;
  const provider = {
    fetch() {
      if (mode === "down") return deferred(clock, { afterMs: 10, error: Object.assign(new Error("synthetic"), { code: "SYNTHETIC" }) });
      if (mode === "hang") return new Promise(() => {});
      const values = Object.fromEntries(p.flags.map((f) => [f.key, f.defaultValue]));
      values[p.flag.key] = mode === "garbage" ? { unexpected: true } : value;
      return deferred(clock, { afterMs: 10, value: { values } });
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, provider, flags: JSON.parse(JSON.stringify(p.flags)), client: { ...p.client } });
    if (!sut || typeof sut.evaluate !== "function") throw new Error("sin evaluate()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const limit = p.client.timeoutMs + 1000;
  const evalKey = (key) => settle(() => sut.evaluate(key), clock, limit);
  const steps = [];
  try {
    await advanceTo(clock, T0 + 100);
    if (id === "unknown-flag") steps.push({ result: classify(await evalKey(UNKNOWN_KEY), p, "unknown") });
    else steps.push({ result: classify(await evalKey(p.flag.key), p) });
    if (id === "propagation") {
      value = p.updatedValue;
      await advanceTo(clock, clock.now() + p.client.refreshSeconds * 1000 + 1000);
      steps.push({ result: classify(await evalKey(p.flag.key), p, "updated") });
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const id of SCENARIOS) scenarios.push(await runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, classify };
