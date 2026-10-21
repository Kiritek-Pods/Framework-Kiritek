"use strict";

/**
 * Adaptador CI provider-neutral.
 *
 * Expone la selección de alcance por evento y delega en los MISMOS módulos que
 * los hooks locales (staged-scan, push-scan, scanners), para que la decisión
 * sea equivalente localmente y en CI con el mismo commit+config. No reimplementa
 * reglas de detección.
 *
 * La salida mínima común es JSON + exit code portable, independientemente del
 * proveedor de CI.
 *
 * (Requisitos 3.4–3.5, 15.1–15.3, 15.7–15.8, 22.5–22.7, G.3, G.8.)
 */

const EVENT = Object.freeze({
  PULL_REQUEST: "pull_request",
  PUSH: "push",
  SCHEDULE: "schedule",
  MANUAL: "manual",
});

/**
 * Mapea un evento de CI al alcance de escaneo requerido.
 * @returns {"range"|"repository"|"history"}
 */
function scopeForEvent(event, { historyDepth } = {}) {
  switch (event) {
    case EVENT.PULL_REQUEST:
      return "range"; // el rango completo del PR
    case EVENT.PUSH:
      return "repository";
    case EVENT.SCHEDULE:
    case EVENT.MANUAL:
      return historyDepth === "full" ? "history" : "repository";
    default:
      throw new Error(`evento de CI desconocido: ${event}`);
  }
}

/**
 * Verifica que el checkout tenga historial suficiente para el alcance pedido.
 * No lo "arregla" en silencio: si falta, señala que debe obtenerse o fallar.
 *
 * @returns {{ sufficient: boolean, reason?: string }}
 */
function checkHistorySufficiency(scope, { shallow }) {
  if ((scope === "history" || scope === "range") && shallow) {
    return { sufficient: false, reason: "checkout shallow; se requiere fetch-depth suficiente para el alcance" };
  }
  return { sufficient: true };
}

/**
 * Resuelve el plan de ejecución de CI (sin ejecutar el escaneo todavía).
 *
 * @param {object} opts { event, mode, historyDepth, shallow }
 * @returns {{ event, scope, mode, history }}
 */
function planCiRun(opts) {
  const event = opts.event;
  const scope = scopeForEvent(event, { historyDepth: opts.historyDepth });
  const history = checkHistorySufficiency(scope, { shallow: !!opts.shallow });
  return {
    event,
    scope,
    mode: opts.mode === "enforce" ? "enforce" : "warning",
    history,
  };
}

module.exports = { EVENT, scopeForEvent, checkHistorySufficiency, planCiRun };
