"use strict";

/**
 * Harness conductual de operaciones largas (T44.2). Framework-neutral: el
 * adapter conecta el handler que inicia la operación y el de su estado; el
 * trabajo pesado pasa por `deps.work`:
 *
 *   createApiUnderTest({ clock, deps: { work({ input, signal }) → Promise } })
 *     → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * Iniciar debe responder 202 con la URL de estado en el header Location. El
 * harness consulta esa URL cada segundo virtual hasta un estado terminal.
 * En `stuck`, `work` sólo termina si se aborta su `signal`.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { call, leaks } = require("../shared/http.js");
const { SCENARIOS, MAX_OPERATIONS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-long-operations-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const WORK_MS = 3000;
const POLL_MS = 1000;
const QUICK_MS = 500;
const INTERNAL = "falló el worker en /srv/app/jobs/worker.js:42 (kcanary-internal)";

const pathOf = (location) => {
  if (!location) return null;
  try {
    return new URL(location, "http://kiritek.test").pathname;
  } catch (_) {
    return null;
  }
};

async function runScenario(o, scenario, factory) {
  const id = `${scenario}@${o.id}`;
  const clock = createVirtualClock(T0);
  let aborted = false;
  const work = ({ signal } = {}) => {
    if (scenario === "stuck") {
      return new Promise((_, reject) => {
        if (signal && typeof signal.addEventListener === "function")
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
      });
    }
    if (scenario === "fails") return deferred(clock, { afterMs: 1000, error: Object.assign(new Error(INTERNAL), { code: "EWORKER" }) });
    return deferred(clock, { afterMs: WORK_MS, value: { ok: true } });
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: { work } });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const get = (path) => call(sut, { method: "GET", path, headers: { accept: "application/json" } }, clock);
  const start = async () => {
    const t = clock.now();
    const r = await call(sut, { method: o.method, path: o.path, headers: { "content-type": "application/json" }, body: o.sampleBody ? JSON.parse(JSON.stringify(o.sampleBody)) : {} }, clock, WORK_MS * 4);
    return { r, elapsed: clock.now() - t, statusPath: r ? pathOf(r.headers.location) : null };
  };
  const statusOf = (r) => (r && r.body && typeof r.body === "object" ? r.body[o.statusField] : undefined);
  /** Consulta hasta un estado terminal o `deadline` ms virtuales. */
  const poll = async (statusPath, deadline) => {
    const until = clock.now() + deadline;
    let last = null;
    while (statusPath && clock.now() <= until) {
      last = await get(statusPath);
      const s = statusOf(last);
      if (s === o.done || s === o.failed) return { final: s, res: last, at: clock.now() };
      await advanceTo(clock, clock.now() + POLL_MS);
    }
    return { final: undefined, res: last, at: clock.now() };
  };
  let step;
  try {
    if (scenario === "accepted") {
      const { r, elapsed, statusPath } = await start();
      step = { accepted: !!r && r.status === 202, quick: !!r && elapsed <= QUICK_MS, located: !!statusPath };
    } else if (scenario === "completes") {
      const { statusPath } = await start();
      const p = await poll(statusPath, o.maxDurationMs + WORK_MS);
      step = { completed: p.final === o.done };
    } else if (scenario === "fails") {
      const { statusPath } = await start();
      const p = await poll(statusPath, o.maxDurationMs + WORK_MS);
      step = { failedReported: p.final === o.failed, noLeak: !p.res || !leaks(p.res.text) };
    } else if (scenario === "stuck") {
      const t = clock.now();
      const { statusPath } = await start();
      const p = await poll(statusPath, o.maxDurationMs * 2 + POLL_MS * 2);
      const timedOut = p.final === o.failed && p.at - t <= Math.ceil(o.maxDurationMs * 1.1) + POLL_MS * 2;
      step = { timedOut, cancelled: !timedOut || aborted };
    } else {
      const r = await get(o.statusPath.replace(":id", "kop-desconocida"));
      step = { notFound: !!r && r.status === 404 };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const o of (params.operations || []).slice(0, MAX_OPERATIONS)) for (const s of SCENARIOS) scenarios.push(await runScenario(o, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
