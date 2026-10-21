"use strict";

/**
 * Ejecuta `fn` (sync o async) avanzando el reloj virtual hasta que la promesa
 * se resuelva o venza `limitMs` de tiempo virtual. Devuelve
 * `{ ok: true, v }`, `{ ok: false, error }` o `null` si no terminó (colgado).
 */

const { flush } = require("./virtual-clock.js");

async function settle(fn, clock, limitMs = 30000) {
  let state = null;
  Promise.resolve()
    .then(fn)
    .then(
      (v) => (state = { ok: true, v }),
      (error) => (state = { ok: false, error })
    );
  const until = clock.now() + limitMs;
  for (let guard = 0; guard < 100000 && !state; guard += 1) {
    await flush();
    if (state) break;
    const due = clock.nextDue(until);
    if (!due) break;
    clock.take(due);
    due.fn();
  }
  await flush();
  return state;
}

/** Promesa controlada por el harness: se resuelve/rechaza con un timer virtual o nunca. */
function deferred(clock, { afterMs = 0, value, error, hang = false } = {}) {
  return new Promise((resolve, reject) => {
    if (hang) return;
    clock.setTimeout(() => (error ? reject(error) : resolve(value)), afterMs);
  });
}

module.exports = { settle, deferred };
