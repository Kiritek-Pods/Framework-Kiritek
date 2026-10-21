"use strict";

/**
 * Harness conductual de schemas de respuesta (T43.2). Framework-neutral: el
 * adapter conecta el handler real con sus datos de prueba.
 *
 *   createApiUnderTest({ clock, deps: {} })
 *     → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * Cada respuesta se valida contra el schema declarado para su endpoint (y la
 * de error contra `errorSchema`). La traza sólo lleva booleanos.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { validate } = require("../../../../domain/schema-validator.js");
const { call, is4xx } = require("../shared/http.js");
const { undeclared } = require("./schema-subset.js");
const { scenariosFor, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-response-schema-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

const conforms = (value, schemaJson) => {
  try {
    return validate(value, JSON.parse(schemaJson), { extended: true }).valid;
  } catch (_) {
    return false;
  }
};

async function runScenario(e, scenario, factory, p) {
  const id = `${scenario}@${e.id}`;
  const clock = createVirtualClock(T0);
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: {} });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const withBody = !["GET", "DELETE"].includes(e.method);
  const send = (body) => call(sut, { method: e.method, path: e.path, headers: { "content-type": "application/json", accept: "application/json" }, ...(withBody ? { body } : {}) }, clock);
  let step;
  try {
    if (scenario === "success") {
      const r = await send(e.sampleBody ? JSON.parse(JSON.stringify(e.sampleBody)) : {});
      const body = r ? r.body : undefined;
      const parsed = !!r && body !== null && typeof body === "object";
      step = { statusOk: !!r && r.status === e.status, schemaOk: parsed && conforms(body, e.responseSchema), noUndeclared: parsed && undeclared(body, JSON.parse(e.responseSchema)) === 0 };
    } else {
      const r = await send(JSON.parse(JSON.stringify(e.invalidBody)));
      step = { clientError: !!r && is4xx(r.status), errorSchemaOk: !!r && r.body !== null && typeof r.body === "object" && conforms(r.body, p.errorSchema) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const e of (params.endpoints || []).slice(0, MAX_ENDPOINTS)) for (const s of scenariosFor(e, params)) scenarios.push(await runScenario(e, s, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
