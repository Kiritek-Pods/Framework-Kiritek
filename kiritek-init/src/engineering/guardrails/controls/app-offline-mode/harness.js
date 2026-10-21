"use strict";

/**
 * Harness conductual de modo sin conexión (T28.2). Reloj, red, transporte y
 * almacenamiento persistente inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su app real):
 *
 *   createOfflineAppUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     network,    // { online() → boolean, onChange(cb) } — el harness corta y devuelve la red
 *     transport,  // { send({ action, payload }) → Promise } — rechaza sin red
 *     storage,    // { getItem(k), setItem(k, v), removeItem(k) } — sobrevive a reinicios
 *     actions,    // acciones del contrato
 *   }) → { perform(actionId, payload) → Promise, view() → { offlineNotice, pending } }
 *
 *   Una acción `online-only` sin red debe rechazarse (perform rechaza o
 *   resuelve `{ ok: false }`), nunca darse por hecha ni encolarse.
 *
 * La traza sólo lleva conteos y booleanos: nunca los payloads.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { scenarioIds } = require("./scenarios.js");

const HARNESS = { name: "kiritek-offline-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(id, factory, facts) {
  const [scenario, actionId] = id.split("@");
  const clock = createVirtualClock(T0);
  let online = true;
  const listeners = [];
  const network = { online: () => online, onChange: (cb) => typeof cb === "function" && listeners.push(cb) };
  const setOnline = (v) => {
    online = v;
    for (const cb of [...listeners]) {
      try {
        cb(v);
      } catch (_) {
        /* listener del adapter que lanza */
      }
    }
  };
  const delivered = [];
  const transport = {
    send(req) {
      if (!online) return deferred(clock, { afterMs: 10, error: Object.assign(new Error("offline"), { code: "ENETUNREACH" }) });
      delivered.push({ action: req && req.action, n: req && req.payload && req.payload.n });
      return deferred(clock, { afterMs: 20, value: { ok: true } });
    },
  };
  const map = new Map();
  const storage = { getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null), setItem: (k, v) => void map.set(String(k), String(v)), removeItem: (k) => void map.delete(String(k)) };
  const create = () => factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, network, transport, storage, actions: JSON.parse(JSON.stringify(facts.actions)) });
  let sut;
  try {
    sut = create();
    if (!sut || typeof sut.perform !== "function" || typeof sut.view !== "function") throw new Error("API incompleta");
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
  const perform = (n) => settle(() => sut.perform(actionId, { n }), clock, 10000);
  const mine = () => delivered.filter((d) => d.action === actionId);
  const wait = (ms) => advanceTo(clock, clock.now() + ms);
  const okState = (st) => !!st && st.ok && !(st.v && st.v.ok === false);
  const steps = [];
  try {
    if (scenario === "notice") {
      setOnline(false);
      await wait(1000);
      steps.push({ notice: view().offlineNotice === true });
      setOnline(true);
      await wait(1000);
      steps.push({ notice: view().offlineNotice === true });
    } else if (scenario === "online") {
      const st = await perform(1);
      await wait(1000);
      steps.push({ accepted: okState(st), delivered: mine().length });
    } else if (scenario === "queue") {
      setOnline(false);
      const st = await perform(1);
      await wait(5000);
      setOnline(true);
      await wait(30000);
      steps.push({ accepted: okState(st), delivered: mine().length, drained: Number(view().pending || 0) === 0 });
    } else if (scenario === "restart") {
      setOnline(false);
      await perform(1);
      await wait(1000);
      listeners.length = 0;
      try {
        sut = create();
      } catch (_) {
        return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
      }
      setOnline(true);
      await wait(30000);
      steps.push({ delivered: mine().length, drained: Number(view().pending || 0) === 0 });
    } else if (scenario === "order") {
      setOnline(false);
      await perform(1);
      await perform(2);
      setOnline(true);
      await wait(30000);
      const ns = mine().map((d) => d.n);
      steps.push({ delivered: ns.length, ordered: ns.length === 2 && ns[0] === 1 && ns[1] === 2 });
    } else if (scenario === "offline-reject") {
      setOnline(false);
      const st = await perform(1);
      setOnline(true);
      await wait(30000);
      steps.push({ rejectedOffline: !okState(st), delivered: mine().length });
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const id of scenarioIds(params)) scenarios.push(await runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
