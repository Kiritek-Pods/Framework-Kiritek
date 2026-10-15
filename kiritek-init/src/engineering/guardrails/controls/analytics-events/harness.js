"use strict";

/**
 * Harness conductual de analytics (T25.2). Reloj, transporte y perfil de
 * usuario sintético (con canarios de PII) inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su capa de tracking):
 *
 *   createTrackerUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,  // { send(payload) → Promise } — payload: evento, lista de eventos o { events }
 *                 //   evento: { name, properties }; puede rechazar (red caída)
 *     plan,       // eventos del plan de tracking
 *     user,       // perfil sintético que la app conoce (incluye email/teléfono/nombre canario)
 *   }) → { trigger(eventName), flush() }
 *
 * `trigger` corre el flujo de la app que emite ese evento. La traza sólo lleva
 * conteos y booleanos: nunca propiedades ni payloads.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { planned } = require("./scenarios.js");

const HARNESS = { name: "kiritek-analytics-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const USER = Object.freeze({ id: "user-0001", email: "kcanary.persona@example.test", name: "Kcanary Persona", phone: "+56 9 0000 0000", plan: "pro" });
const CANARIES = [/kcanary/i, /0000 0000/];

/** Normaliza lo enviado a una lista de { name, properties }. */
function eventsOf(payload) {
  const list = Array.isArray(payload) ? payload : payload && Array.isArray(payload.events) ? payload.events : [payload];
  return list.filter((e) => e && typeof e === "object").map((e) => ({ name: e.name || e.event, properties: e.properties || e.props || {} }));
}

function conforms(ev, spec) {
  const props = ev.properties && typeof ev.properties === "object" ? ev.properties : {};
  for (const p of spec.properties) {
    const v = props[p.name];
    if (v === undefined || v === null) {
      if (p.required) return false;
      continue;
    }
    if (typeof v !== p.type) return false;
    if (p.enum && !p.enum.includes(v)) return false;
  }
  return true;
}

async function runScenario(id, factory, plan) {
  const clock = createVirtualClock(T0);
  const delivered = [];
  const raw = [];
  let down = id === "transport-down";
  const transport = {
    send(payload) {
      raw.push(JSON.stringify(payload === undefined ? null : payload));
      if (down) return deferred(clock, { afterMs: 20, error: Object.assign(new Error("synthetic"), { code: "ECONNRESET" }) });
      delivered.push(...eventsOf(payload));
      return deferred(clock, { afterMs: 20, value: { ok: true } });
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, plan: JSON.parse(JSON.stringify(plan)), user: { ...USER } });
    if (!sut || typeof sut.trigger !== "function") throw new Error("sin trigger()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const flush = () => settle(() => (typeof sut.flush === "function" ? sut.flush() : undefined), clock, 10000);
  let step;
  try {
    if (id.startsWith("schema#")) {
      const name = id.slice("schema#".length);
      const spec = plan.find((e) => e.name === name);
      await settle(() => sut.trigger(name), clock, 10000);
      await flush();
      await advanceTo(clock, clock.now() + 1000);
      const mine = delivered.filter((e) => e.name === name);
      const allowed = new Set(spec.properties.map((p) => p.name));
      step = { emitted: mine.length, schemaOk: mine.length > 0 && mine.every((e) => conforms(e, spec)), noExtra: mine.every((e) => Object.keys(e.properties || {}).every((k) => allowed.has(k))) };
    } else if (id === "no-pii") {
      for (const e of plan) await settle(() => sut.trigger(e.name), clock, 10000);
      await flush();
      await advanceTo(clock, clock.now() + 1000);
      step = { piiLeak: raw.some((r) => CANARIES.some((c) => c.test(r))) };
    } else {
      const results = [];
      for (const e of plan) results.push(await settle(() => sut.trigger(e.name), clock, 10000));
      await flush();
      await advanceTo(clock, clock.now() + 2000);
      down = false;
      await advanceTo(clock, clock.now() + 60000);
      await flush();
      await advanceTo(clock, clock.now() + 1000);
      const counts = {};
      for (const e of delivered) counts[e.name] = (counts[e.name] || 0) + 1;
      step = { isolated: results.every((r) => r && r.ok), noDuplicates: Object.values(counts).every((n) => n <= 1) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const plan = planned({ events: params.events || [] });
  const ids = [...plan.map((e) => `schema#${e.name}`), "no-pii", "transport-down"];
  const scenarios = [];
  for (const id of ids) scenarios.push(await runScenario(id, factory, plan));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, USER, runSuite, runScenario, eventsOf, conforms };
