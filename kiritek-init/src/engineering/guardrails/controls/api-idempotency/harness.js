"use strict";

/**
 * Harness conductual de idempotencia de la API (T32.2). Framework-neutral:
 * el adapter conecta el handler HTTP real del equipo en proceso.
 *
 *   createApiUnderTest({
 *     clock,  // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     deps,   // { effect(endpointId) } — el adapter lo llama donde ocurre el efecto
 *             //   real (insertar el pedido, cobrar…), en vez de la dependencia real
 *   }) → { handle({ method, path, query, headers, body, ip }) → Promise<{ status, headers, body }> }
 *
 * Se mide cuántas veces ocurrió el efecto, no cómo está implementado.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { canonicalJson } = require("../../canonical.js");
const { call, is2xx, is4xx, is5xx } = require("../shared/http.js");
const { scenariosFor, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-idempotency-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(e, scenario, factory) {
  const id = `${scenario}@${e.id}`;
  const clock = createVirtualClock(T0);
  let effects = 0;
  const deps = { effect: (endpointId) => void (endpointId === undefined || endpointId === e.id ? (effects += 1) : null) };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const req = (key, body = e.sampleBody) => ({ method: e.method, path: e.path, headers: { "content-type": "application/json", ...(key ? { [e.keyHeader]: key } : {}) }, body: JSON.parse(JSON.stringify(body)) });
  const send = (key, body) => call(sut, req(key, body), clock);
  const ok = (r) => !!r && is2xx(r.status);
  const same = (a, b) => !!a && !!b && a.status === b.status && canonicalJson(a.body === undefined ? null : a.body) === canonicalJson(b.body === undefined ? null : b.body);
  let step;
  try {
    if (scenario === "replay") {
      const a = await send("kidem-replay-1");
      const b = await send("kidem-replay-1");
      step = { firstOk: ok(a), effects, sameResponse: same(a, b) };
    } else if (scenario === "concurrent") {
      const [a, b] = await Promise.all([send("kidem-conc-1"), send("kidem-conc-1")]);
      step = { effects, noServerError: !!a && !!b && !is5xx(a.status) && !is5xx(b.status) && (ok(a) || ok(b)) };
    } else if (scenario === "distinct-keys") {
      const a = await send("kidem-a-1");
      const b = await send("kidem-b-1");
      step = { effects, bothOk: ok(a) && ok(b) };
    } else if (scenario === "key-mismatch") {
      await send("kidem-mm-1");
      const b = await send("kidem-mm-1", { ...e.sampleBody, kiritekVariant: 2 });
      step = { effects, mismatchRejected: !!b && is4xx(b.status) };
    } else {
      const a = await send(null);
      step = { effects, rejected: !!a && is4xx(a.status) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const e of (params.endpoints || []).slice(0, MAX_ENDPOINTS)) for (const s of scenariosFor(e)) scenarios.push(await runScenario(e, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
