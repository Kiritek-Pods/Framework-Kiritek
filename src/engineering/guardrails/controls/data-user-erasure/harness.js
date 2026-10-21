"use strict";

/**
 * Harness conductual de borrado de datos del usuario (T47.2). Framework-
 * neutral: el adapter conecta el servicio real; sus repositorios leen y
 * escriben en los almacenes sintéticos `deps.stores[<id>]` (uno por tabla,
 * colección o servicio declarado):
 *
 *   createServiceUnderTest({ clock, deps: { stores: { <id>: {
 *     all() → Promise<row[]>, insert(row), update(pred, patch) → n, remove(pred) → n
 *   } } } }) → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * Cada almacén arranca con filas del usuario `kuser-a` (el que se borra) y de
 * `kuser-b`, con email, teléfono y nombre canario. Las filas siguen la forma
 * `{ id, userId, email, phone, name }`; el adapter las mapea a su modelo.
 * La traza sólo dice si quedaron rastros, nunca filas.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { call, is2xx, is5xx } = require("../shared/http.js");
const { MAX_STORES } = require("./scenarios.js");

const HARNESS = { name: "kiritek-user-erasure-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const SETTLE_MS = 60000;
const USERS = {
  "kuser-a": { email: "kcanary.borrar@example.test", phone: "+56 9 7777 0001", name: "Kiri Borrable" },
  "kuser-b": { email: "kcanary.queda@example.test", phone: "+56 9 7777 0002", name: "Kiri Permanece" },
};
const TRACES_A = ["kuser-a", ...Object.values(USERS["kuser-a"])];

const mentionsA = (value) => {
  const text = JSON.stringify(value === undefined ? null : value);
  return TRACES_A.some((t) => text.includes(t));
};

function makeStore(id) {
  // Ids de fila neutros: sólo userId y los datos canario identifican al usuario.
  let rows = [];
  let seq = 0;
  for (const [userId, data] of Object.entries(USERS)) for (let n = 0; n < 2; n += 1) rows.push({ id: `${id}-${++seq}`, userId, ...data });
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return {
    rows: () => rows,
    api: {
      all: async () => copy(rows),
      insert: async (row) => void rows.push(copy(row)),
      update: async (pred, patch) => {
        let n = 0;
        rows = rows.map((r) => (pred(copy(r)) ? (n++, { ...r, ...copy(patch) }) : r));
        return n;
      },
      remove: async (pred) => {
        const before = rows.length;
        rows = rows.filter((r) => !pred(copy(r)));
        return before - rows.length;
      },
    },
  };
}

async function runScenario(id, factory, p) {
  const clock = createVirtualClock(T0);
  const stores = Object.fromEntries(p.stores.slice(0, MAX_STORES).map((s) => [s.id, makeStore(s.id)]));
  const snapshotB = () => JSON.stringify(Object.values(stores).map((s) => s.rows().filter((r) => r.userId === "kuser-b")));
  const initialB = snapshotB();
  const total = () => Object.values(stores).reduce((n, s) => n + s.rows().length, 0);
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: { stores: Object.fromEntries(Object.entries(stores).map(([k, s]) => [k, s.api])) } });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const erase = async (userId) => {
    const r = await call(sut, { method: p.erasure.method, path: p.erasure.path.replace(":userId", userId), headers: { authorization: `Bearer ${userId === "kuser-nadie" ? "kadmin" : userId}` } }, clock);
    await advanceTo(clock, clock.now() + SETTLE_MS);
    return r;
  };
  const [scenario, target] = id.split("@");
  let step;
  try {
    if (scenario === "store") {
      const r = await erase("kuser-a");
      step = { accepted: !!r && is2xx(r.status), clean: !stores[target].rows().some(mentionsA) };
    } else if (scenario === "others") {
      await erase("kuser-a");
      step = { intact: snapshotB() === initialB };
    } else if (scenario === "reads") {
      await erase("kuser-a");
      let clean = true;
      for (const rd of p.reads) {
        const r = await call(sut, { method: "GET", path: rd.path.replace(":userId", "kuser-a"), headers: { authorization: "Bearer kadmin" } }, clock);
        if (r && is2xx(r.status) && mentionsA(r.body)) clean = false;
      }
      step = { noReappearance: clean };
    } else if (scenario === "repeat") {
      await erase("kuser-a");
      const again = await erase("kuser-a");
      step = { noServerError: !!again && !again.threw && again.status !== 0 && !is5xx(again.status) };
    } else {
      const before = total();
      const r = await erase("kuser-nadie");
      step = { noServerError: !!r && !r.threw && r.status !== 0 && !is5xx(r.status), nothingDeleted: total() === before && snapshotB() === initialB };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const ids = [...params.stores.slice(0, MAX_STORES).map((s) => `store@${s.id}`), "others", (params.reads || []).length && "reads", "repeat", "unknown"].filter(Boolean);
  const scenarios = [];
  for (const id of ids) scenarios.push(await runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, USERS, runSuite, runScenario };
