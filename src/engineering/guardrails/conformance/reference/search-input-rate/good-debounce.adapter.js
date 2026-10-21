"use strict";
// Búsqueda correcta con DEBOUNCE: mínimo, cancelación, guarda de obsolescencia,
// dedupe por clave normalizada y propagación de errores (no de cancelaciones).
const MIN = 3;
const WINDOW = 250;
const DEDUPE = 500;
exports.createSearchUnderTest = ({ clock, transport, onResults, onError }) => {
  let timer = null;
  let controller = null;
  let latest = 0;
  const cache = new Map();
  const run = (q, key) => {
    const hit = cache.get(key);
    if (hit && clock.now() - hit.t < DEDUPE) return onResults(q, hit.results);
    if (controller) controller.abort();
    controller = new AbortController();
    const token = ++latest;
    transport.search(q, { signal: controller.signal }).then(
      (r) => {
        if (token !== latest) return;
        cache.set(key, { t: clock.now(), results: r });
        onResults(q, r);
      },
      (e) => {
        if (e.name === "AbortError" || token !== latest) return;
        onError(q, e);
      }
    );
  };
  return {
    type(q) {
      const key = q.trim().toLowerCase();
      clock.clearTimeout(timer);
      if (key.length < MIN) return;
      timer = clock.setTimeout(() => run(q, key), WINDOW);
    },
  };
};
