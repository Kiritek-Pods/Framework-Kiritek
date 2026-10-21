"use strict";

/**
 * Harness conductual de versionado de API (T40.2). Framework-neutral: el
 * adapter conecta el router real con todas sus versiones montadas.
 *
 *   createApiUnderTest({ clock, deps: {} })
 *     → { handle({ method, path, query, headers }) → Promise<{ status, headers, body }> }
 *
 * Esquema `path`: la versión va como prefijo (`/v1/orders`). Esquema
 * `header`: la versión va en el header declarado. La traza sólo dice qué se
 * cumplió, nunca headers ni cuerpos.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { call, is2xx, is4xx } = require("../shared/http.js");
const { scenariosFor, UNKNOWN_VERSION, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-versioning-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

/** Día (YYYY-MM-DD, UTC) de un header Sunset (HTTP-date) o null. */
function sunsetDay(value) {
  const t = Date.parse(String(value || ""));
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Primer objeto representativo de la respuesta: el cuerpo o el primer ítem de una lista. */
function sample(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body)) return body[0] && typeof body[0] === "object" ? body[0] : null;
  for (const v of Object.values(body)) if (Array.isArray(v) && v[0] && typeof v[0] === "object") return v[0];
  return body;
}

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
  const get = (version) =>
    p.scheme === "path" ? call(sut, { method: "GET", path: `/${version}${e.path}`, headers: {} }, clock) : call(sut, { method: "GET", path: e.path, headers: { [p.header.toLowerCase()]: version } }, clock);
  const live = p.versions.filter((v) => v.status !== "retired");
  let step;
  try {
    if (scenario === "served") {
      const rs = [];
      for (const v of live) rs.push(await get(v.id));
      step = { allServed: rs.every((r) => !!r && is2xx(r.status)) };
    } else if (scenario === "deprecation") {
      let deprecatedMarked = true;
      let sunsetMarked = true;
      let supportedClean = true;
      for (const v of live) {
        const r = await get(v.id);
        const dep = r && r.headers.deprecation !== undefined && r.headers.deprecation !== "" && r.headers.deprecation !== "false";
        if (v.status === "deprecated") {
          if (!dep) deprecatedMarked = false;
          if (v.sunset && (!r || sunsetDay(r.headers.sunset) !== v.sunset)) sunsetMarked = false;
        } else if (dep) supportedClean = false;
      }
      step = { deprecatedMarked, sunsetMarked, supportedClean };
    } else if (scenario === "unknown") {
      const r = await get(UNKNOWN_VERSION);
      step = { rejected: !!r && is4xx(r.status) };
    } else if (scenario === "retired") {
      const rs = [];
      for (const v of p.versions.filter((x) => x.status === "retired")) rs.push(await get(v.id));
      step = { gone: rs.every((r) => !!r && (r.status === 410 || r.status === 404)) };
    } else {
      let fieldsKept = true;
      for (const v of live.filter((x) => x.requiredFields.length)) {
        const r = await get(v.id);
        const obj = r && is2xx(r.status) ? sample(r.body) : null;
        if (!obj || !v.requiredFields.every((f) => Object.prototype.hasOwnProperty.call(obj, f))) fieldsKept = false;
      }
      step = { fieldsKept };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const e of (params.endpoints || []).slice(0, MAX_ENDPOINTS)) for (const s of scenariosFor(params)) scenarios.push(await runScenario(e, s, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, sunsetDay };
