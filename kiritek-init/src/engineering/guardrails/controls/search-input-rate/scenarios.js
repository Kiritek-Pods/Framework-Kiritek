"use strict";

/**
 * Escenarios obligatorios de `search.input-rate` (R9.8; T10.1–T10.2).
 *
 * Todas las consultas son SINTÉTICAS (alfabetos sin significado) y en la
 * traza sólo aparecen como IDs opacos (`q<n>`, clave de equivalencia
 * `k<n>`) más su longitud. Nunca se usan ni persisten consultas reales
 * (R9.10, R15.2). Los tiempos son de un reloj virtual: el resultado es
 * reproducible y no depende de la máquina.
 */

const REQUIRED_SCENARIOS = Object.freeze(["burst", "min-chars", "supersede", "out-of-order", "equivalent", "error-propagation"]);
const ALPHA_A = "zqxjvkwyhzqxjvkwyhzqxjvkwyhzqxjvkwyh";
const ALPHA_B = "vkwyhzqxjvkwyhzqxjvkwyhzqxjvkwyhzqxj";
const ALPHA_C = "hjxqzwkvyhjxqzwkvyhjxqzwkvyhjxqzwkvy";

function synthetic(alpha, len) {
  return alpha.slice(0, Math.max(1, len));
}

/** Regla de equivalencia declarada en el contrato. */
function equivalenceKey(rule, text) {
  if (rule === "trim") return text.trim();
  if (rule === "trim-lowercase") return text.trim().toLowerCase();
  return text;
}

/** Variante equivalente según la regla (idéntica si la regla es exacta). */
function equivalentVariant(rule, text) {
  if (rule === "trim") return `${text}  `;
  if (rule === "trim-lowercase") return ` ${text.toUpperCase()} `;
  return text;
}

/**
 * Plan declarativo de cada escenario. `steps` se ejecuta en orden:
 *   { at, type: "input", text }   — el usuario escribe `text` en t=at
 *   { at, type: "end" }           — avanzar hasta t=at y cerrar
 * `latency(text)` define cuándo responde el transporte para esa consulta;
 * `fail(text)` lo hace fallar con error no-abort; `cancellable` define si el
 * transporte respeta AbortSignal.
 */
function buildPlans(params) {
  const w = params.windowMs;
  const min = params.minChars;
  const rule = params.equivalence;
  const step = Math.max(1, Math.floor(w / 5));
  const plans = {};

  plans.burst = {
    cancellable: true,
    latency: () => 10,
    steps: [...Array.from({ length: 6 }, (_, i) => ({ at: i * step, type: "input", text: synthetic(ALPHA_A, min + i) })), { at: 6 * step + 4 * w, type: "end" }],
  };

  const shortLens = Array.from({ length: Math.max(0, min - 1) }, (_, i) => i + 1);
  plans["min-chars"] = {
    cancellable: true,
    latency: () => 10,
    steps: [...shortLens.map((len, i) => ({ at: i * 2 * w, type: "input", text: synthetic(ALPHA_A, len) })), { at: shortLens.length * 2 * w + 4 * w, type: "end" }],
  };

  const a = synthetic(ALPHA_A, min + 1);
  const b = synthetic(ALPHA_B, min + 1);
  plans.supersede = {
    cancellable: params.cancellation === "supported",
    latency: (t) => (t === a ? 10 * w : 10),
    steps: [{ at: 0, type: "input", text: a }, { at: 3 * w, type: "input", text: b }, { at: 20 * w, type: "end" }],
  };
  plans["out-of-order"] = {
    cancellable: false,
    latency: (t) => (t === a ? 10 * w : 10),
    steps: [{ at: 0, type: "input", text: a }, { at: 3 * w, type: "input", text: b }, { at: 20 * w, type: "end" }],
  };

  const eq = synthetic(ALPHA_C, min + 1);
  plans.equivalent = {
    cancellable: true,
    latency: () => 10,
    steps: [{ at: 0, type: "input", text: eq }, { at: w + 10, type: "input", text: equivalentVariant(rule, eq) }, { at: 6 * w + params.dedupeWindowMs, type: "end" }],
  };

  const fail = synthetic(ALPHA_B, min + 2);
  const c = synthetic(ALPHA_C, min + 2);
  const d = synthetic(ALPHA_A, min + 3);
  plans["error-propagation"] = {
    cancellable: true,
    latency: (t) => (t === c ? 10 * w : 10),
    fail: (t) => t === fail,
    steps: [
      { at: 0, type: "input", text: fail },
      { at: 4 * w, type: "input", text: c },
      { at: 7 * w, type: "input", text: d },
      { at: 24 * w, type: "end" },
    ],
  };
  return { plans, equivalenceKey: (t) => equivalenceKey(rule, t) };
}

/** Todos los textos sintéticos que el harness puede usar (canarios de privacidad). */
function syntheticTexts(params) {
  const { plans } = buildPlans(params);
  return [...new Set(Object.values(plans).flatMap((p) => p.steps.filter((s) => s.type === "input").map((s) => s.text.trim())))];
}

module.exports = { REQUIRED_SCENARIOS, buildPlans, equivalenceKey, equivalentVariant, syntheticTexts };
