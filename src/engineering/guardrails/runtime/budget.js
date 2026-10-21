"use strict";

/**
 * Presupuestos por momento y concurrencia (T07.2; design §12–13).
 *
 * - El presupuesto total de la ejecución sale de la config efectiva
 *   (`execution.budgetsMs[moment]`); cada control recibe
 *   min(timeout del control, presupuesto del momento del control, restante).
 * - Agotado el presupuesto, el control no se ejecuta: estado `timeout` con
 *   `BUDGET_EXHAUSTED` y el fallback explícito del control/momento — nunca
 *   deny ni omisión silenciosa.
 * - `createPool` limita procesos concurrentes (`execution.maxProcesses`).
 */

function createRunBudget({ totalMs, nowMs = Date.now }) {
  const start = nowMs();
  return {
    totalMs,
    elapsed: () => nowMs() - start,
    remaining: () => Math.max(0, totalMs - (nowMs() - start)),
    exhausted: () => nowMs() - start >= totalMs,
    /** Tiempo asignable a una tarea que pide `requestedMs`. */
    allot(...limits) {
      return Math.max(0, Math.min(...limits, totalMs - (nowMs() - start)));
    },
  };
}

/** Fallback declarado del control para un momento (nunca deny). */
function fallbackFor(control, moment) {
  const m = control.moments.find((x) => x.moment === moment);
  return m ? m.fallback : "error-operational";
}

function createPool(maxConcurrency) {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new TypeError("maxConcurrency debe ser entero >= 1");
  let running = 0;
  let peak = 0;
  const queue = [];
  const next = () => {
    if (running >= maxConcurrency || queue.length === 0) return;
    const { task, resolve, reject } = queue.shift();
    running += 1;
    peak = Math.max(peak, running);
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        running -= 1;
        next();
      });
  };
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        next();
      });
    },
    get peak() {
      return peak;
    },
  };
}

module.exports = { createRunBudget, fallbackFor, createPool };
