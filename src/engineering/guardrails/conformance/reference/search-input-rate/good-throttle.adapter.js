"use strict";
// Búsqueda correcta con THROTTLE (leading + trailing): otra estrategia válida.
const MIN = 3;
const WINDOW = 250;
const DEDUPE = 500;
exports.createSearchUnderTest = ({ clock, transport, onResults, onError }) => {
  let lastStart = -Infinity;
  let timer = null;
  let pending = null;
  let controller = null;
  let latest = 0;
  let lastKey = null;
  let lastKeyAt = -Infinity;
  let lastResults = null;
  const fire = (q) => {
    const key = q.trim().toLowerCase();
    lastStart = clock.now();
    if (key === lastKey && clock.now() - lastKeyAt < DEDUPE && lastResults) return onResults(q, lastResults);
    lastKey = key;
    lastKeyAt = clock.now();
    if (controller) controller.abort();
    controller = new AbortController();
    const token = ++latest;
    transport.search(q, { signal: controller.signal }).then(
      (r) => {
        if (token !== latest) return;
        lastResults = r;
        onResults(q, r);
      },
      (e) => {
        if (e.name !== "AbortError" && token === latest) onError(q, e);
      }
    );
  };
  return {
    type(q) {
      if (q.trim().length < MIN) return;
      pending = q;
      const elapsed = clock.now() - lastStart;
      if (elapsed >= WINDOW && !timer) return fire(q);
      if (!timer) {
        timer = clock.setTimeout(() => {
          timer = null;
          fire(pending);
        }, WINDOW - elapsed);
      }
    },
  };
};
