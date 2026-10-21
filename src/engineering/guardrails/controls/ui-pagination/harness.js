"use strict";

/**
 * Harness conductual de listas paginadas (T24.2). Reloj y transporte
 * inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su lista real):
 *
 *   createListUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,  // { fetchPage({ cursor?, offset?, limit }) → Promise<{ items: [{ id }], nextCursor, hasMore }> }
 *     list,       // { id, pageSize, mode, endState } del contrato
 *   }) → { mount(), loadMore(), view() → { items: [id], end, loading, error } }
 *
 * Los ítems son opacos y sintéticos; la traza sólo lleva conteos y booleanos.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { scenariosFor, datasetSize, minRequests, MAX_LISTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-pagination-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(l, scenario, factory) {
  const id = `${scenario}@${l.id}`;
  const clock = createVirtualClock(T0);
  let data = Array.from({ length: datasetSize(l) }, (_, i) => `item-${i + 1}`);
  const original = [...data];
  let requests = 0;
  let pending = 0;
  let maxPending = 0;
  let firstLimit = null;
  let failNext = false;
  const transport = {
    fetchPage(req = {}) {
      requests += 1;
      pending += 1;
      maxPending = Math.max(maxPending, pending);
      const limit = Math.max(1, Math.min(1000, Number(req.limit) || l.pageSize));
      if (firstLimit === null) firstLimit = req.limit;
      const fail = failNext;
      failNext = false;
      let start = 0;
      if (req.cursor !== undefined && req.cursor !== null) start = data.indexOf(String(req.cursor)) + 1;
      else if (Number.isInteger(req.offset)) start = req.offset;
      const items = data.slice(start, start + limit).map((x) => ({ id: x }));
      const hasMore = start + limit < data.length;
      const p = deferred(clock, { afterMs: 50, value: { items, nextCursor: hasMore && items.length ? items[items.length - 1].id : null, hasMore }, error: fail ? Object.assign(new Error("synthetic"), { code: "SYNTHETIC" }) : null });
      return p.finally(() => (pending -= 1));
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, list: { ...l } });
    if (!sut || ["mount", "loadMore", "view"].some((m) => typeof sut[m] !== "function")) throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const fire = (fn) => {
    try {
      Promise.resolve(fn()).catch(() => {});
    } catch (_) {
      /* la lista que lanza no avanza: hecho observado */
    }
  };
  const view = () => {
    try {
      const v = sut.view();
      return { items: v && Array.isArray(v.items) ? v.items.map(String) : [], end: !!(v && v.end), error: !!(v && v.error) };
    } catch (_) {
      return { items: [], end: false, error: false };
    }
  };
  let t = 0;
  const wait = (ms = 300) => advanceTo(clock, T0 + (t += ms));
  const unique = (items) => new Set(items).size === items.length;
  const steps = [];
  try {
    fire(() => sut.mount());
    await wait();
    if (scenario === "first-page") {
      steps.push({ requests, count: view().items.length, limitOk: firstLimit === l.pageSize });
    } else if (scenario === "all-pages" || scenario === "load-after-end") {
      for (let i = 0; i < minRequests(l) + 2 && !view().end; i += 1) {
        fire(() => sut.loadMore());
        await wait();
      }
      const v = view();
      if (scenario === "all-pages") {
        steps.push({ requests, complete: original.every((x) => v.items.includes(x)), noDuplicates: unique(v.items), ordered: v.items.join("|") === original.join("|"), endShown: v.end, requestsOk: requests <= minRequests(l) + 1 });
      } else {
        const before = requests;
        for (let i = 0; i < 2; i += 1) {
          fire(() => sut.loadMore());
          await wait();
        }
        steps.push({ requests, requestsAfterEnd: v.end ? requests - before : requests });
      }
    } else if (scenario === "concurrent-load") {
      fire(() => sut.loadMore());
      fire(() => sut.loadMore());
      await wait();
      const v = view();
      steps.push({ requests, noDuplicates: unique(v.items), singleFlight: maxPending <= 1 });
    } else if (scenario === "page-error") {
      failNext = true;
      fire(() => sut.loadMore());
      await wait();
      const v = view();
      steps.push({ requests, kept: v.items.length === l.pageSize, error: v.error });
      fire(() => sut.loadMore());
      await wait();
      const after = view();
      steps.push({ requests, recovered: after.items.length === Math.min(2 * l.pageSize, original.length) && !after.error && unique(after.items) });
    } else if (scenario === "shifting") {
      data = ["item-new-1", "item-new-2", ...data];
      fire(() => sut.loadMore());
      await wait();
      const v = view();
      const expected = original.slice(0, Math.min(2 * l.pageSize, original.length));
      steps.push({ requests, noDuplicates: unique(v.items), noSkipped: expected.every((x) => v.items.includes(x)) });
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const l of (params.lists || []).slice(0, MAX_LISTS)) for (const s of scenariosFor(l)) scenarios.push(await runScenario(l, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
