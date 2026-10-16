"use strict";

/**
 * Harness conductual de paginación de API (T35.2). Framework-neutral: el
 * adapter conecta el handler de listado real; su repositorio lee de
 * `deps.store.all()` (ítems sintéticos en el orden de la fuente).
 *
 *   createApiUnderTest({ clock, deps: { store: { all() → [{ id }] } } })
 *     → { handle({ method, path, query, headers }) → Promise<{ status, headers, body }> }
 *
 * Respuesta esperada: `body[itemsField]` (lista de `{ id }`) y, en modo cursor,
 * `body[cursorField]` (null al final).
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { call, is2xx, is4xx, is5xx } = require("../shared/http.js");
const { scenariosFor, datasetSize, MAX_COLLECTIONS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-pagination-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(c, scenario, factory) {
  const id = `${scenario}@${c.id}`;
  const clock = createVirtualClock(T0);
  // En max-size el dataset supera el máximo, para que la falta de tope se note.
  const n = scenario === "max-size" ? c.maxPageSize + 5 : datasetSize(c);
  let data = Array.from({ length: n }, (_, i) => ({ id: `kitem-${i + 1}` }));
  const original = data.map((x) => x.id);
  const deps = { store: { all: () => data.map((x) => ({ ...x })) } };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  let requests = 0;
  const get = (query) => {
    requests += 1;
    return call(sut, { method: "GET", path: c.path, query: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])), headers: {} }, clock);
  };
  const itemsOf = (r) => (r && r.body && Array.isArray(r.body[c.itemsField]) ? r.body[c.itemsField].map((x) => String(x && x.id)) : null);
  const unique = (ids) => new Set(ids).size === ids.length;
  const size = c.defaultPageSize;
  const nextQuery = (r, seen) => {
    if (c.mode === "cursor") {
      const cur = r && r.body ? r.body[c.cursorField] : null;
      return cur === null || cur === undefined || cur === "" ? null : { [c.limitParam]: size, [c.cursorParam]: cur };
    }
    const page = itemsOf(r) || [];
    return page.length < size ? null : { [c.limitParam]: size, [c.offsetParam]: seen.length };
  };
  let step;
  try {
    if (scenario === "default-size") {
      const r = await get({});
      const ids = itemsOf(r);
      step = { ok: !!r && is2xx(r.status), defaultSizeOk: !!ids && ids.length === size };
    } else if (scenario === "max-size") {
      const r = await get({ [c.limitParam]: c.maxPageSize * 10 });
      const ids = itemsOf(r);
      step = { capped: !!r && ((is2xx(r.status) && !!ids && ids.length <= c.maxPageSize) || is4xx(r.status)) };
    } else if (scenario === "walk") {
      const seen = [];
      let r = await get({ [c.limitParam]: size });
      for (let guard = 0; r && is2xx(r.status) && guard < 50; guard += 1) {
        seen.push(...(itemsOf(r) || []));
        const q = nextQuery(r, seen);
        if (!q) break;
        r = await get(q);
      }
      const minimal = Math.ceil(original.length / size);
      step = { complete: original.every((x) => seen.includes(x)), noDuplicates: unique(seen), ordered: seen.join("|") === original.join("|"), requestsOk: requests <= minimal + 1 };
    } else if (scenario === "bad-limit") {
      const a = await get({ [c.limitParam]: -1 });
      const b = await get({ [c.limitParam]: "muchos" });
      step = { noServerError: !!a && !!b && !a.threw && !b.threw && !is5xx(a.status) && !is5xx(b.status) && a.status !== 0 && b.status !== 0 };
    } else if (scenario === "stable-cursor") {
      const first = await get({ [c.limitParam]: size });
      const seen = [...(itemsOf(first) || [])];
      data = [{ id: "kitem-new-1" }, { id: "kitem-new-2" }, ...data];
      const q = nextQuery(first, seen);
      const second = q ? await get(q) : null;
      seen.push(...(itemsOf(second) || []));
      const expected = original.slice(0, Math.min(2 * size, original.length));
      step = { noDuplicates: unique(seen), noSkipped: expected.every((x) => seen.includes(x)) };
    } else {
      const r = await get({ [c.limitParam]: size, [c.cursorParam]: "%%kiritek-cursor-basura" });
      step = { clientError: !!r && is4xx(r.status) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const c of (params.collections || []).slice(0, MAX_COLLECTIONS)) for (const s of scenariosFor(c)) scenarios.push(await runScenario(c, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
