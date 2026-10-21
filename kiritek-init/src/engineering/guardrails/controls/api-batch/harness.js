"use strict";

/**
 * Harness conductual de operaciones en lote (T45.2). Framework-neutral: el
 * adapter conecta el handler real; su repositorio escribe en `deps.store`:
 *
 *   createApiUnderTest({ clock, deps: { store: {
 *     save(item) → Promise,                       // falla para el ítem `k-2` en `apply-failure`
 *     transaction(async (tx) => { await tx.save(item) }) → Promise,  // todo o nada
 *   } } }) → { handle({ method, path, query, headers, body }) → Promise<{ status, headers, body }> }
 *
 * Cada ítem lleva su referencia en `refField` (`k-1`, `k-2`, `k-3`) y la
 * respuesta debe traer un resultado por ítem, en orden, con esa referencia.
 * Modo `partial`: los ítems buenos se aplican y el malo se informa. Modo
 * `atomic`: no se aplica ninguno y se responde con error.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { call, is2xx, is4xx, is5xx } = require("../shared/http.js");
const { SCENARIOS, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-batch-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const REFS = ["k-1", "k-2", "k-3"];

/** Un resultado por ítem: falla si trae error, ok:false o un status no 2xx. */
const failed = (r) => !!r && typeof r === "object" && (r.error !== undefined || r.ok === false || (typeof r.status === "number" && !is2xx(r.status)) || r.status === "failed" || r.status === "error");

async function runScenario(e, scenario, factory) {
  const id = `${scenario}@${e.id}`;
  const clock = createVirtualClock(T0);
  const saved = new Set();
  const failOn = scenario === "apply-failure" ? "k-2" : null;
  const write = (item, into) => {
    const ref = item && item[e.refField];
    if (ref === failOn) throw Object.assign(new Error("violación de restricción"), { code: "ECONSTRAINT" });
    into.add(ref);
  };
  const store = {
    save: async (item) => write(item, saved),
    transaction: async (fn) => {
      const pending = new Set();
      await fn({ save: async (item) => write(item, pending) });
      for (const ref of pending) saved.add(ref);
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: { store } });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const item = (base, ref) => ({ ...JSON.parse(JSON.stringify(base)), [e.refField]: ref });
  const send = (items) => call(sut, { method: e.method, path: e.path, headers: { "content-type": "application/json" }, body: { [e.itemsField]: items } }, clock);
  const resultsOf = (r) => (r && r.body && Array.isArray(r.body[e.resultsField]) ? r.body[e.resultsField] : null);
  const atomic = e.mode === "atomic";
  let step;
  try {
    if (scenario === "all-ok") {
      const r = await send(REFS.map((ref) => item(e.sampleItem, ref)));
      const results = resultsOf(r);
      step = {
        ok: !!r && is2xx(r.status),
        complete: !!results && results.length === REFS.length && !results.some(failed),
        ordered: !!results && results.length === REFS.length && results.every((x, i) => x && x[e.refField] === REFS[i]),
        persisted: REFS.every((ref) => saved.has(ref)),
      };
    } else if (scenario === "invalid-item" || scenario === "apply-failure") {
      const bad = scenario === "invalid-item" ? e.invalidItem : e.sampleItem;
      const r = await send([item(e.sampleItem, "k-1"), item(bad, "k-2"), item(e.sampleItem, "k-3")]);
      if (atomic) {
        step = { reported: !!r && r.status >= 400, nothingApplied: saved.size === 0 };
      } else {
        const results = resultsOf(r);
        const byRef = (ref) => (results || []).find((x) => x && x[e.refField] === ref);
        step = {
          reported: !!r && !is5xx(r.status) && !!results && failed(byRef("k-2")) && !failed(byRef("k-1")) && !failed(byRef("k-3")) && !!byRef("k-1") && !!byRef("k-3"),
          othersApplied: saved.has("k-1") && saved.has("k-3") && !saved.has("k-2"),
        };
      }
    } else if (scenario === "over-limit") {
      const r = await send(Array.from({ length: e.maxItems + 1 }, (_, i) => item(e.sampleItem, `k-${i + 1}`)));
      step = { rejected: !!r && is4xx(r.status), nothingApplied: saved.size === 0 };
    } else {
      const r = await send([]);
      step = { noServerError: !!r && !r.threw && r.status !== 0 && !is5xx(r.status) && saved.size === 0 };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const e of (params.endpoints || []).slice(0, MAX_ENDPOINTS)) for (const s of SCENARIOS) scenarios.push(await runScenario(e, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
