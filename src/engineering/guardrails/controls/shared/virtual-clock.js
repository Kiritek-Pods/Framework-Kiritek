"use strict";

/**
 * Reloj virtual compartido por los harness conductuales (T10, T11).
 * Determinista: los timers vencen por tiempo y, a igual tiempo, por orden de
 * creación. `now` puede fijarse (p. ej. reloj local manipulado en T11).
 */

function createVirtualClock(start = 0) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, id });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    nextDue(until) {
      let best = null;
      for (const t of timers.values()) {
        if (t.at <= until && (!best || t.at < best.at || (t.at === best.at && t.id < best.id))) best = t;
      }
      return best;
    },
    take(t) {
      timers.delete(t.id);
      now = Math.max(now, t.at);
    },
    setNow(t) {
      now = Math.max(now, t);
    },
    pending: () => timers.size,
  };
}

/** Vacía la cola de microtareas (promesas) del proceso. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Avanza ejecutando timers vencidos hasta `until`. */
async function advanceTo(clock, until) {
  for (let guard = 0; guard < 100000; guard += 1) {
    await flush();
    const due = clock.nextDue(until);
    if (!due) break;
    clock.take(due);
    due.fn();
  }
  await flush();
  clock.setNow(until);
}

module.exports = { createVirtualClock, flush, advanceTo };
