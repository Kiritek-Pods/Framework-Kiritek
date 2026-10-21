"use strict";

/**
 * Harness conductual de versión mínima (T11.1). Reloj virtual, transporte,
 * cache y stores inyectados; ninguna red real.
 *
 * Interfaz del adapter (glue del equipo, framework-neutral):
 *
 *   createVersionGateUnderTest({
 *     clock,          // { now(), setTimeout(fn, ms), clearTimeout(id) } — reloj LOCAL del dispositivo
 *     transport,      // { fetchPolicy({ environment, signal }) → Promise<{ policy, signature, serverTime }> }
 *     cache,          // { read() → { policy, storedAt } | null, write(entry) }
 *     stores,         // { resolve(platform) → { available: boolean } }
 *     platform, installedVersion, environment,
 *   }) → { evaluate(): Promise<Decision> }
 *
 *   Decision: { action: none|soft|hard|blocked-offline, canContinue, canPostpone,
 *               updateTarget: store|enterprise|fallback|none, explanationAccessible,
 *               exitAvailable, policySource: remote|cache|stale-cache|none }
 *
 * La decisión se SANEA: sólo campos conocidos con valores válidos llegan a la
 * traza; cualquier otro (p. ej. tokens de dispositivo/cuenta/store) se
 * descarta y sólo se cuenta (`droppedFields`).
 */

const { createVirtualClock, flush } = require("../shared/virtual-clock.js");
const { buildScenarios } = require("./scenarios.js");

const ENUMS = {
  action: ["none", "soft", "hard", "blocked-offline"],
  updateTarget: ["store", "enterprise", "fallback", "none"],
  policySource: ["remote", "cache", "stale-cache", "none"],
};
const BOOLS = ["canContinue", "canPostpone", "explanationAccessible", "exitAvailable"];

function sanitize(decision) {
  const out = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(decision && typeof decision === "object" ? decision : {})) {
    if (ENUMS[k] && ENUMS[k].includes(v)) out[k] = v;
    else if (BOOLS.includes(k) && typeof v === "boolean") out[k] = v;
    else dropped += 1;
  }
  if (dropped) out.droppedFields = dropped;
  return out;
}

async function settle(promise, clock, limitMs) {
  let state = null;
  promise.then((v) => (state = { ok: true, v }), () => (state = { ok: false }));
  const start = clock.now();
  for (let guard = 0; guard < 100000 && !state; guard += 1) {
    await flush();
    if (state) break;
    const due = clock.nextDue(start + limitMs);
    if (!due) break;
    clock.take(due);
    due.fn();
  }
  await flush();
  return { state, elapsed: clock.now() - start };
}

async function runScenario(id, plan, factory, params) {
  const clock = createVirtualClock(plan.deviceStart);
  const serverOffset = plan.serverOffsetMs || 0;
  let current = null;
  let cacheEntry = plan.cache ? { policy: plan.cache.policy, storedAt: plan.deviceStart + plan.cache.storedAtOffsetMs } : null;
  const transport = {
    fetchPolicy({ signal } = {}) {
      const step = current;
      if (step.transport === "offline") return Promise.reject(Object.assign(new Error("offline"), { name: "NetworkError" }));
      if (step.transport === "hang") {
        return new Promise((_, reject) => {
          if (signal && typeof signal.addEventListener === "function") {
            signal.addEventListener("abort", () => reject(Object.assign(new Error("abortado"), { name: "AbortError" })), { once: true });
          }
        });
      }
      const serverTime = clock.now() + serverOffset;
      if (step.transport === "invalid-payload") return Promise.resolve({ policy: { minimumVersion: "2.x", issuedAt: "ayer" }, signature: "valid", serverTime });
      return Promise.resolve({ policy: JSON.parse(JSON.stringify(step.policy)), signature: step.signature, serverTime });
    },
  };
  const cache = {
    read: () => (cacheEntry ? JSON.parse(JSON.stringify(cacheEntry)) : null),
    write: (entry) => {
      cacheEntry = JSON.parse(JSON.stringify(entry));
    },
  };
  const stores = { resolve: () => ({ available: !!plan.store.available }) };

  let sut;
  try {
    sut = factory({
      clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
      transport,
      cache,
      stores,
      platform: plan.platform,
      installedVersion: plan.installed,
      environment: params.environment,
    });
    if (!sut || typeof sut.evaluate !== "function") throw new Error("sin evaluate()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", decisions: [] };
  }
  const decisions = [];
  try {
    for (const step of plan.steps) {
      if (step.advanceMs) {
        // Avanza el reloj ejecutando timers pendientes (p. ej. expiración de cache).
        const target = clock.now() + step.advanceMs;
        for (let due = clock.nextDue(target); due; due = clock.nextDue(target)) {
          clock.take(due);
          due.fn();
          await flush();
        }
        clock.setNow(target);
      }
      current = step;
      const started = clock.now();
      const { state } = await settle(Promise.resolve().then(() => sut.evaluate()), clock, Math.max(params.timeoutMs * 10, 60000));
      if (!state) decisions.push({ settled: false, settledAt: clock.now() - started });
      else if (!state.ok) return { id, status: "error", limitation: "ADAPTER_THREW", decisions };
      else decisions.push({ settled: true, settledAt: clock.now() - started, ...sanitize(state.v) });
    }
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_THREW", decisions };
  }
  return { id, status: "ok", decisions };
}

async function runSuite(factory, params) {
  const plans = buildScenarios(params);
  const scenarios = [];
  for (const [id, plan] of Object.entries(plans)) scenarios.push(await runScenario(id, plan, factory, params));
  return { schemaVersion: 1, harness: { name: "kiritek-version-harness", version: "1.0.0" }, scenarios };
}

module.exports = { runSuite, runScenario, sanitize };
