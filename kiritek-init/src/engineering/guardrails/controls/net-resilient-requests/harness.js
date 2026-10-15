"use strict";

/**
 * Harness conductual de llamadas de red (T20.2). Reloj virtual, transporte
 * y `random` inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su cliente HTTP real):
 *
 *   createClientUnderTest({
 *     clock,       // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,   // { send({ operation, headers }) → Promise<{ status, headers }> }
 *                  //   rechaza con { code: "ECONNRESET" } ante error de red;
 *                  //   puede no responder nunca (el cliente debe aplicar su timeout)
 *     random,      // () → número en [0, 1) — usar para jitter
 *     operations,  // operaciones del contrato
 *   }) → { call(operationId) → Promise }   // resuelve si hubo éxito, rechaza si no
 *
 * La traza sólo lleva intentos, esperas y booleanos: nunca payloads ni claves.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { scenariosFor, planFor, settleLimit, MAX_OPERATIONS, RESPONSE_MS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-requests-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

const keyOf = (headers) => {
  if (!headers || typeof headers !== "object") return null;
  const k = Object.keys(headers).find((h) => h.toLowerCase() === "idempotency-key");
  return k && typeof headers[k] === "string" && headers[k] ? headers[k] : null;
};

async function runScenario(op, scenario, factory, operations) {
  const id = `${scenario}@${op.id}`;
  const clock = createVirtualClock(T0);
  const plan = planFor(scenario, op);
  const sends = [];
  const transport = {
    send(request) {
      const r = plan[Math.min(sends.length, plan.length - 1)];
      sends.push({ at: clock.now(), key: keyOf(request && request.headers) });
      if (r.hang) return new Promise(() => {});
      if (r.network) return deferred(clock, { afterMs: RESPONSE_MS, error: Object.assign(new Error("synthetic"), { code: "ECONNRESET" }) });
      const headers = r.retryAfterSeconds ? { "retry-after": String(r.retryAfterSeconds) } : {};
      return deferred(clock, { afterMs: RESPONSE_MS, value: { status: r.status, headers } });
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, random: () => 0.5, operations: JSON.parse(JSON.stringify(operations)) });
    if (!sut || typeof sut.call !== "function") throw new Error("sin call()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  let state;
  try {
    state = await settle(() => sut.call(op.id), clock, settleLimit(op));
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  const keys = sends.map((s) => s.key);
  const step = {
    settled: !!state,
    ok: !!state && state.ok === true,
    attempts: sends.length,
    gaps: sends.slice(1).map((s, i) => s.at - sends[i].at).slice(0, 10),
    keyed: keys.length > 0 && keys.every(Boolean),
    sameKey: keys.length > 0 && keys.every((k) => k && k === keys[0]),
  };
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  const ops = (params.operations || []).slice(0, MAX_OPERATIONS);
  for (const op of ops) for (const s of scenariosFor(op)) scenarios.push(await runScenario(op, s, factory, ops));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
