"use strict";

/**
 * Harness conductual de health checks y apagado ordenado (T37.2).
 * Framework-neutral: el adapter conecta el servidor real en proceso.
 *
 *   createServiceUnderTest({
 *     clock,
 *     deps,   // { [dependencyId]: { ping() → Promise }, work() → Promise } — work() es el
 *             //   trabajo lento del endpoint `work` (tarda 2 s, o nunca en grace-bound)
 *   }) → { handle(req) → Promise<{ status, headers, body }>, shutdown() → Promise }
 *
 * `shutdown()` es lo que el servidor hace al recibir SIGTERM.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { call, is2xx } = require("../shared/http.js");
const { scenarioIds } = require("./scenarios.js");

const HARNESS = { name: "kiritek-health-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const WORK_MS = 2000;

async function runScenario(id, factory, p) {
  const [scenario, downDep] = id.split("@");
  const clock = createVirtualClock(T0);
  const deps = {
    work: () => (scenario === "grace-bound" ? new Promise(() => {}) : deferred(clock, { afterMs: WORK_MS, value: { ok: true } })),
  };
  for (const d of p.dependencies) {
    deps[d] = { ping: () => (d === downDep ? deferred(clock, { afterMs: 10, error: Object.assign(new Error("synthetic"), { code: "ECONNREFUSED" }) }) : deferred(clock, { afterMs: 10, value: { ok: true } })) };
  }
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function" || typeof sut.shutdown !== "function") throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const get = (path) => call(sut, { method: "GET", path, headers: {} }, clock, 5000);
  const ok = (r) => !!r && is2xx(r.status);
  let step;
  try {
    if (scenario === "live") step = { live: ok(await get(p.livenessPath)) };
    else if (scenario === "ready") step = { ready: ok(await get(p.readinessPath)) };
    else if (scenario === "not-ready") {
      const ready = await get(p.readinessPath);
      const live = await get(p.livenessPath);
      step = { readinessDown: !!ready && !ready.threw && ready.status >= 500, stillLive: ok(live) };
    } else {
      // Trabajo en curso; a los 100 ms llega el SIGTERM.
      let inFlight = null;
      sut.handle({ method: p.work.method, path: p.work.path, query: {}, headers: {}, ip: "203.0.113.10" }).then(
        (r) => (inFlight = { status: Number(r && r.status) || 0 }),
        () => (inFlight = { status: 0 })
      );
      await advanceTo(clock, T0 + 100);
      let done = null;
      Promise.resolve()
        .then(() => sut.shutdown())
        .then(
          () => (done = clock.now()),
          () => (done = clock.now())
        );
      await advanceTo(clock, T0 + 200);
      if (scenario === "grace-bound") {
        await advanceTo(clock, T0 + p.shutdownGraceMs + 2000);
        step = { shutdownBounded: done !== null };
      } else {
        const ready = await call(sut, { method: "GET", path: p.readinessPath, headers: {} }, clock, 500);
        // Esperar lo que tardaría el trabajo: aceptarlo a medias también se detecta.
        const fresh = await call(sut, { method: p.work.method, path: p.work.path, headers: {} }, clock, WORK_MS + 1000);
        await advanceTo(clock, T0 + p.shutdownGraceMs + 2000);
        step = {
          inFlightCompleted: !!inFlight && is2xx(inFlight.status),
          readinessDown: !ready || ready.status >= 500,
          newRejected: !!fresh && !fresh.threw && fresh.status >= 500,
          shutdownSettled: done !== null,
        };
      }
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const id of scenarioIds(params)) scenarios.push(await runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
