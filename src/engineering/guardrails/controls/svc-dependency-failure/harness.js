"use strict";

/**
 * Harness conductual de dependencias caídas (T36.2). Framework-neutral: el
 * adapter conecta el handler real y le pasa estas dependencias sintéticas en
 * lugar de las reales (base, servicio HTTP, cache…).
 *
 *   createServiceUnderTest({
 *     clock,
 *     deps,   // { [dependencyId]: { call(args) → Promise } } — responde, se cuelga o falla
 *   }) → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * El timeout y el circuit breaker deben medir el tiempo con `clock`.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { call, is2xx, is5xx } = require("../shared/http.js");
const { scenariosFor, BREAKER_REQUESTS, MAX_DEPS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-dependencies-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(dep, scenario, factory, p) {
  const id = `${scenario}@${dep.id}`;
  const clock = createVirtualClock(T0);
  let mode = { hang: "hang", error: "error", breaker: "error" }[scenario] || "ok";
  let calls = 0;
  const deps = {};
  for (const d of p.dependencies) {
    deps[d.id] = {
      call() {
        if (d.id !== dep.id) return deferred(clock, { afterMs: 20, value: { ok: true } });
        calls += 1;
        if (mode === "hang") return new Promise(() => {});
        if (mode === "error") return deferred(clock, { afterMs: 10, error: Object.assign(new Error("synthetic"), { code: "ECONNRESET" }) });
        return deferred(clock, { afterMs: 20, value: { ok: true } });
      },
    };
  }
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const req = () => ({ method: p.endpoint.method, path: p.endpoint.path, headers: { "content-type": "application/json" }, ...(p.endpoint.sampleBody ? { body: JSON.parse(JSON.stringify(p.endpoint.sampleBody)) } : {}) });
  const failureOk = (r) => !!r && !r.threw && (dep.degraded === "required" ? is2xx(r.status) : is5xx(r.status) && r.status !== 500);
  let step;
  try {
    if (scenario === "healthy") {
      const r = await call(sut, req(), clock, 30000);
      step = { ok: !!r && is2xx(r.status) };
    } else if (scenario === "hang" || scenario === "error") {
      const r = await call(sut, req(), clock, dep.timeoutMs + 2000);
      step = { settled: !!r, statusOk: failureOk(r) };
    } else {
      for (let i = 0; i < BREAKER_REQUESTS; i += 1) {
        await call(sut, req(), clock, dep.timeoutMs + 2000);
        await advanceTo(clock, clock.now() + 100);
      }
      const opened = calls < BREAKER_REQUESTS;
      mode = "ok";
      await advanceTo(clock, clock.now() + 120000);
      let last = null;
      for (let i = 0; i < 3; i += 1) {
        last = await call(sut, req(), clock, dep.timeoutMs + 2000);
        await advanceTo(clock, clock.now() + 1000);
      }
      step = { opened, recovered: !!last && is2xx(last.status), depCalls: calls };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const d of (params.dependencies || []).slice(0, MAX_DEPS)) for (const s of scenariosFor(d)) scenarios.push(await runScenario(d, s, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
