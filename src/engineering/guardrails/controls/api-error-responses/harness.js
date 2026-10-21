"use strict";

/**
 * Harness conductual de errores de API (T33.2). Framework-neutral: el
 * adapter conecta el handler HTTP real del equipo en proceso.
 *
 *   createApiUnderTest({
 *     clock,
 *     deps,   // { dependency() → Promise } — el adapter lo usa en lugar de su base/servicio;
 *             //   en el escenario de error interno lanza un error con detalles internos canario
 *   }) → { handle({ method, path, query, headers, body, ip }) → Promise<{ status, headers, body }> }
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { call, leaks, is5xx } = require("../shared/http.js");
const { scenarioIds } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-errors-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const CANARY = "kcanary-internal: ECONNREFUSED 10.0.0.5:5432 SELECT * FROM users\n    at Pool.connect (/srv/app/src/db.js:42:7)";

function formatOk(res, p) {
  if (!res || !res.body || typeof res.body !== "object") return false;
  if (p.errorFormat === "problem+json") {
    return String(res.headers["content-type"] || "").includes("application/problem+json") && (typeof res.body.type === "string" || typeof res.body.title === "string") && Number(res.body.status) === res.status;
  }
  const holder = res.body.error && typeof res.body.error === "object" ? res.body.error : res.body;
  return p.errorFields.every((f) => holder[f] !== undefined && holder[f] !== null);
}

async function runScenario(id, factory, p) {
  const [scenario, endpointId] = id.split("@");
  const e = p.endpoints.find((x) => x.id === endpointId);
  const clock = createVirtualClock(T0);
  const failing = scenario === "internal";
  const deps = {
    dependency: async () => {
      if (failing) throw Object.assign(new Error(CANARY), { code: "ECONNREFUSED" });
      return { ok: true };
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const json = { "content-type": "application/json" };
  const check = (res, statusOk) => ({ statusOk: !!res && !res.threw && statusOk(res.status), formatOk: !!res && formatOk(res, p), noLeak: !!res && !leaks(res.text) && !leaks(JSON.stringify(res.headers)) });
  let step;
  try {
    if (scenario === "not-found") {
      step = check(await call(sut, { method: "GET", path: "/kiritek-no-existe/zz9", headers: {} }, clock), (s) => s === 404);
    } else if (scenario === "invalid") {
      const all = [];
      for (const body of e.invalidBodies) all.push(check(await call(sut, { method: e.method, path: e.path, headers: json, body: JSON.parse(JSON.stringify(body)) }, clock), (s) => s === 400 || s === 422));
      step = { statusOk: all.every((x) => x.statusOk), formatOk: all.every((x) => x.formatOk), noLeak: all.every((x) => x.noLeak) };
    } else if (scenario === "malformed") {
      step = check(await call(sut, { method: e.method, path: e.path, headers: json, body: "{ roto" }, clock), (s) => s === 400);
    } else {
      step = check(await call(sut, { method: e.method, path: e.path, headers: json, body: JSON.parse(JSON.stringify(e.sampleBody)) }, clock), (s) => is5xx(s));
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

module.exports = { HARNESS, CANARY, runSuite, runScenario, formatOk };
