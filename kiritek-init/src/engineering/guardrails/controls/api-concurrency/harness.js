"use strict";

/**
 * Harness conductual de edición concurrente (T39.2). Framework-neutral: el
 * adapter conecta el handler real de lectura y actualización; su repositorio
 * usa `deps.store` (asíncrono, con latencia virtual):
 *
 *   createApiUnderTest({ clock, deps: { store: {
 *     get(id) → Promise<{ id, version, ...campos } | null>,
 *     save(record) → Promise<void>,                          // escribe sin comparar
 *     saveIfVersion(record, expectedVersion) → Promise<bool>, // compare-and-set atómico
 *   } } }) → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * GET y la actualización usan `path` con `:id` reemplazado por el id sintético.
 * Modo `etag`: versión en el header ETag y precondición en If-Match. Modo
 * `version-field`: versión en `body[versionField]` y precondición en el cuerpo.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { call, is2xx } = require("../shared/http.js");
const { scenariosFor, MAX_RESOURCES } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-concurrency-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const ID = "kres-1";
const LATENCY_MS = 5;

const isConflict = (s) => s === 409 || s === 412;

async function runScenario(r, scenario, factory) {
  const id = `${scenario}@${r.id}`;
  const clock = createVirtualClock(T0);
  const rows = new Map([[ID, { id: ID, [r.field]: "kval-inicial", version: 1 }]]);
  const copy = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  const later = (fn) => deferred(clock, { afterMs: LATENCY_MS }).then(fn);
  const store = {
    get: (key) => later(() => copy(rows.get(String(key)))),
    save: (rec) => later(() => void rows.set(String(rec.id), copy(rec))),
    saveIfVersion: (rec, expected) =>
      later(() => {
        const cur = rows.get(String(rec.id));
        if (!cur || cur.version !== expected) return false;
        rows.set(String(rec.id), copy(rec));
        return true;
      }),
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: { store } });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const path = r.path.replace(":id", ID);
  const read = async () => {
    const res = await call(sut, { method: "GET", path, headers: {} }, clock);
    const token = !res ? undefined : r.mode === "etag" ? res.headers.etag : res.body && typeof res.body === "object" ? res.body[r.versionField] : undefined;
    return { res, token: token === "" || token === null ? undefined : token };
  };
  const update = (value, token) => {
    const headers = { "content-type": "application/json" };
    const body = { [r.field]: value };
    if (token !== undefined) {
      if (r.mode === "etag") headers["if-match"] = String(token);
      else body[r.versionField] = token;
    }
    return call(sut, { method: r.method, path, headers, body }, clock);
  };
  const current = () => (rows.get(ID) || {})[r.field];
  let step;
  try {
    if (scenario === "exposed") {
      const { res, token } = await read();
      step = { ok: !!res && is2xx(res.status), versionExposed: token !== undefined };
    } else if (scenario === "conditional") {
      const { token } = await read();
      const res = await update("kval-a", token);
      const after = await read();
      step = { applied: !!res && is2xx(res.status) && current() === "kval-a", advances: token !== undefined && after.token !== undefined && String(after.token) !== String(token) };
    } else if (scenario === "stale") {
      const { token } = await read();
      await update("kval-a", token);
      const late = await update("kval-b", token);
      step = { rejected: !!late && isConflict(late.status), notOverwritten: current() !== "kval-b" };
    } else if (scenario === "precondition") {
      const res = await update("kval-sin", undefined);
      step = { required: !!res && !is2xx(res.status) && res.status >= 400 && res.status < 500 && current() === "kval-inicial" };
    } else {
      const { token } = await read();
      const [a, b] = await Promise.all([update("kval-a", token), update("kval-b", token)]);
      const wins = [a, b].filter((x) => x && is2xx(x.status)).length;
      const conflicts = [a, b].filter((x) => x && isConflict(x.status)).length;
      const row = rows.get(ID) || {};
      step = { oneWins: wins === 1 && row.version !== 1 && ["kval-a", "kval-b"].includes(row[r.field]), loserRejected: conflicts === 1 };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const r of (params.resources || []).slice(0, MAX_RESOURCES)) for (const s of scenariosFor(r)) scenarios.push(await runScenario(r, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
