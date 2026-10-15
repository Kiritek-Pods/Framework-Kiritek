"use strict";

/**
 * Harness conductual con reloj virtual y transporte controlable (T10.1).
 *
 * Interfaz que implementa el equipo (framework-neutral) — un módulo que
 * exporta:
 *
 *   createSearchUnderTest({ clock, transport, onResults, onError }) → {
 *     type(text),          // el usuario escribe `text` (valor completo del input)
 *     dispose?()
 *   }
 *
 *   clock:     { now(), setTimeout(fn, ms), clearTimeout(id) }  — usar SIEMPRE éste
 *   transport: { search(text, { signal }) → Promise<results> }  — búsqueda remota
 *   onResults(text, results)  — llamar al COMMIT visible de resultados
 *   onError(text, error)      — llamar al mostrar un error al usuario
 *
 * El harness no impone debounce/throttle ni librería: sólo observa eventos.
 * Se ejecuta en un proceso hijo aislado (ver harness-runner.js).
 */

const { buildPlans } = require("./scenarios.js");
const { createVirtualClock, flush } = require("../shared/virtual-clock.js");

/**
 * Ejecuta un escenario contra el adapter. Devuelve eventos con IDs opacos.
 * @returns {Promise<{id, status, events, limitation?}>}
 */
async function runScenario(id, plan, adapterFactory, equivalenceKey) {
  const clock = createVirtualClock();
  const events = [];
  let seq = 0;
  const qids = new Map();
  const keys = new Map();
  const qid = (text) => {
    if (!qids.has(text)) qids.set(text, `q${qids.size + 1}`);
    return qids.get(text);
  };
  const kid = (text) => {
    const k = equivalenceKey(text);
    if (!keys.has(k)) keys.set(k, `k${keys.size + 1}`);
    return keys.get(k);
  };
  const record = (type, fields) => events.push({ seq: seq++, t: clock.now(), type, ...fields });
  let rcount = 0;

  const transport = {
    search(text, opts = {}) {
      const rid = `r${++rcount}`;
      const q = String(text);
      record("request-start", { rid, qid: qid(q), key: kid(q), len: q.length });
      return new Promise((resolve, reject) => {
        let done = false;
        const timer = clock.setTimeout(() => {
          if (done) return;
          done = true;
          if (plan.fail && plan.fail(q)) {
            record("response", { rid, ok: false });
            reject(Object.assign(new Error("fallo sintético del transporte"), { name: "TransportError" }));
          } else {
            record("response", { rid, ok: true });
            resolve({ items: [{ id: `${qid(q)}-r1` }] });
          }
        }, plan.latency(q));
        const signal = opts.signal;
        if (plan.cancellable && signal && typeof signal.addEventListener === "function") {
          const onAbort = () => {
            if (done) return;
            done = true;
            clock.clearTimeout(timer);
            record("request-abort", { rid });
            const err = new Error("abortado");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    },
  };

  let sut;
  try {
    sut = adapterFactory({
      clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
      transport,
      onResults: (text) => record("commit", { qid: qid(String(text)) }),
      onError: (text, error) => record("error-surfaced", { qid: qid(String(text)), aborted: !!(error && error.name === "AbortError") }),
    });
    if (!sut || typeof sut.type !== "function") throw new Error("adapter sin type()");
  } catch (err) {
    return { id, status: "error", events: [], limitation: "ADAPTER_INIT_FAILED" };
  }

  try {
    for (const step of plan.steps) {
      // Avanzar el reloj ejecutando timers vencidos y vaciando microtareas.
      for (let guard = 0; guard < 100000; guard += 1) {
        await flush();
        const due = clock.nextDue(step.at);
        if (!due) break;
        clock.take(due);
        due.fn();
      }
      await flush();
      clock.setNow(step.at);
      if (step.type === "input") {
        const text = step.text;
        record("input", { qid: qid(text), key: kid(text), len: text.length });
        sut.type(text);
        await flush();
      }
    }
    if (typeof sut.dispose === "function") sut.dispose();
  } catch (err) {
    return { id, status: "error", events, limitation: "ADAPTER_THREW" };
  }
  return { id, status: "ok", events };
}

async function runSuite(adapterFactory, params) {
  const { plans, equivalenceKey } = buildPlans(params);
  const scenarios = [];
  for (const [id, plan] of Object.entries(plans)) scenarios.push(await runScenario(id, plan, adapterFactory, equivalenceKey));
  return { schemaVersion: 1, harness: { name: "kiritek-search-harness", version: "1.0.0" }, scenarios };
}

module.exports = { createVirtualClock, runScenario, runSuite };
