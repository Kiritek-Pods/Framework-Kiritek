"use strict";

/**
 * Harness conductual de límites de request (T41.2). Framework-neutral: el
 * adapter conecta el handler real con su límite de cuerpo y su timeout; el
 * trabajo del handler (base, servicio externo) pasa por `deps.work`:
 *
 *   createApiUnderTest({ clock, deps: { work({ signal }) → Promise } })
 *     → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * `body` llega como objeto ya parseado; `headers["content-length"]` trae su
 * tamaño en bytes salvo en el escenario `chunked`, donde el handler debe
 * medirlo. En `slow`, `work` no termina hasta que se aborte su `signal`.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { call, is2xx, is4xx } = require("../shared/http.js");
const { scenariosFor, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-request-limits-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const TIMEOUT_STATUS = new Set([408, 503, 504]);

const bytes = (body) => Buffer.byteLength(JSON.stringify(body), "utf8");

/** Cuerpo de `target` bytes aprox. a partir del de ejemplo (relleno en un campo propio). */
function bodyOf(sample, target) {
  const base = { ...(sample ? JSON.parse(JSON.stringify(sample)) : {}), kiritekPadding: "" };
  base.kiritekPadding = "x".repeat(Math.max(0, target - bytes(base)));
  return base;
}

async function runScenario(e, scenario, factory, p) {
  const id = `${scenario}@${e.id}`;
  const clock = createVirtualClock(T0);
  let calls = 0;
  let aborted = false;
  const work = ({ signal } = {}) => {
    calls += 1;
    if (scenario === "slow") {
      return new Promise((_, reject) => {
        if (signal && typeof signal.addEventListener === "function")
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
      });
    }
    return deferred(clock, { afterMs: scenario === "fast" ? Math.floor(p.timeoutMs / 2) : 1, value: { ok: true } });
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: { work } });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const send = (body, { chunked = false } = {}) => {
    const headers = { "content-type": "application/json" };
    if (body !== undefined) {
      if (chunked) headers["transfer-encoding"] = "chunked";
      else headers["content-length"] = String(bytes(body));
    }
    return call(sut, { method: e.method, path: e.path, headers, ...(body !== undefined ? { body } : {}) }, clock, p.timeoutMs * 3 + 1000);
  };
  const withBody = ["POST", "PUT", "PATCH"].includes(e.method);
  const half = withBody ? bodyOf(e.sampleBody, Math.floor(p.maxBodyBytes / 2)) : undefined;
  // slow/fast prueban sólo el timeout: cuerpo mínimo para no mezclarlo con el límite.
  const minimal = withBody ? bodyOf(e.sampleBody, 0) : undefined;
  let step;
  try {
    if (scenario === "within") {
      const r = await send(half);
      step = { accepted: !!r && is2xx(r.status) };
    } else if (scenario === "oversized" || scenario === "chunked") {
      const r = await send(bodyOf(e.sampleBody, p.maxBodyBytes * 2), { chunked: scenario === "chunked" });
      step = { rejected: !!r && is4xx(r.status), ...(scenario === "oversized" ? { is413: !!r && r.status === 413 } : {}), notProcessed: calls === 0 };
    } else if (scenario === "slow") {
      const start = clock.now();
      const r = await send(minimal);
      const elapsed = clock.now() - start;
      const responded = !!r && !r.threw && r.status !== 0 && elapsed <= Math.ceil(p.timeoutMs * 1.1) + 100;
      step = { responded, timeoutStatus: !responded || TIMEOUT_STATUS.has(r.status), cancelled: !responded || aborted };
    } else {
      const r = await send(minimal);
      step = { ok: !!r && is2xx(r.status) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const e of (params.endpoints || []).slice(0, MAX_ENDPOINTS)) for (const s of scenariosFor(e)) scenarios.push(await runScenario(e, s, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, bodyOf };
