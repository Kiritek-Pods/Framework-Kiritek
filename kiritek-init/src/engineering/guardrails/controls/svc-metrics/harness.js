"use strict";

/**
 * Harness conductual de métricas (T48.2). Framework-neutral: el adapter
 * conecta el servidor real con su registro de métricas (prom-client,
 * Micrometer, OpenTelemetry con exporter Prometheus…); la dependencia que
 * usan los endpoints pasa por `deps.dependency`:
 *
 *   createServiceUnderTest({ clock, deps: { dependency() → Promise } })
 *     → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * `metricsPath` debe responder en formato de texto de Prometheus. La
 * dependencia tarda 250 ms virtuales (o falla, en `errors`): la latencia debe
 * medirse con el `clock` inyectado. La traza sólo lleva booleanos.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { call, is2xx } = require("../shared/http.js");
const { parse, sum } = require("./prometheus.js");
const { PER_ENDPOINT, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-metrics-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const DEP_MS = 250;
const USER = { token: "kcanary-metrics-tok", email: "kcanary.metricas@example.test" };
const ID_PREFIX = "kres-metrics-";

async function runScenario(id, factory, p) {
  const [scenario, epId] = id.split("@");
  const e = p.endpoints.find((x) => x.id === epId);
  const clock = createVirtualClock(T0);
  const failing = scenario === "errors";
  const deps = { dependency: () => deferred(clock, { afterMs: DEP_MS, ...(failing ? { error: Object.assign(new Error("dependencia caída"), { code: "ECONNREFUSED" }) } : { value: { ok: true } }) }) };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const scrape = async () => {
    const r = await call(sut, { method: "GET", path: p.metricsPath, headers: {} }, clock);
    return r && is2xx(r.status) ? parse(typeof r.body === "string" ? r.body : r.text) : null;
  };
  const hit = (n) => call(sut, { method: e.method, path: e.route.replace(/:\w+/g, `${ID_PREFIX}${n}`), headers: { authorization: `Bearer ${USER.token}`, "x-user-email": USER.email } }, clock);
  const L = p.labels;
  const routeMatch = { [L.route]: e ? e.route : "", [L.method]: e ? e.method : "" };
  let step;
  try {
    if (scenario === "exposed") {
      const m = await scrape();
      step = { exposed: !!m, typed: !!m && m.types[p.names.requests] === "counter" && m.types[p.names.duration] === "histogram" };
    } else if (scenario === "counted") {
      const before = sum(await scrape(), p.names.requests, routeMatch);
      for (let i = 1; i <= 3; i += 1) await hit(i);
      step = { counted: sum(await scrape(), p.names.requests, routeMatch) - before === 3 };
    } else if (scenario === "errors") {
      const is5 = (v) => /^5(\d\d|xx)$/i.test(String(v || ""));
      const before = sum(await scrape(), p.names.requests, { ...routeMatch, [L.status]: is5 });
      for (let i = 1; i <= 2; i += 1) await hit(i);
      step = { errorsCounted: sum(await scrape(), p.names.requests, { ...routeMatch, [L.status]: is5 }) - before === 2 };
    } else if (scenario === "latency") {
      const m0 = await scrape();
      const c0 = sum(m0, `${p.names.duration}_count`, routeMatch);
      const s0 = sum(m0, `${p.names.duration}_sum`, routeMatch);
      await hit(1);
      const m1 = await scrape();
      const inf = (m1 ? m1.samples : []).some((s) => s.name === `${p.names.duration}_bucket` && s.labels.le === "+Inf" && s.labels[L.route] === e.route);
      const dSum = sum(m1, `${p.names.duration}_sum`, routeMatch) - s0;
      step = { histogram: inf && sum(m1, `${p.names.duration}_count`, routeMatch) - c0 === 1, timed: dSum >= 0.2 && dSum <= 1 };
    } else {
      for (let i = 1; i <= 5; i += 1) await hit(i);
      const m = await scrape();
      const values = (m ? m.samples : []).flatMap((s) => Object.values(s.labels));
      step = { templated: !m || !values.some((v) => v.includes(ID_PREFIX)), noPii: !m || !values.some((v) => v.includes(USER.token) || v.includes(USER.email)) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const ids = ["exposed", ...(params.endpoints || []).slice(0, MAX_ENDPOINTS).flatMap((e) => PER_ENDPOINT.map((s) => `${s}@${e.id}`))];
  const scenarios = [];
  for (const id of ids) scenarios.push(await runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
