"use strict";

/**
 * Validador de declaraciones de evidencia para plantillas (PR/ticket) y
 * cualquier afirmación de verificación.
 *
 * Regla central (Requisitos 11, 18.5): un estado "verificado" (`verified`,
 * `tested`, `working`, `cumple`) SÓLO es admisible si lo respalda una evidencia
 * vigente del mismo alcance/commit. Sin evidencia fresca y coincidente, la
 * declaración se rechaza (fail-closed). Los estados honestos (`no_ejecutado`,
 * `unverified`, `partial`, `warning`, `failed`) no requieren evidencia.
 *
 * NO reimplementa la lógica de frescura: delega en
 * `src/domain/evidence.js#supportsVerification`.
 */

const { VERIFIED_STATES, supportsVerification } = require("../domain/evidence.js");

// Equivalencias en español que las plantillas pueden usar para un estado
// verificado. Se normalizan al conjunto canónico de `evidence.js`.
const VERIFIED_ALIASES = Object.freeze({
  verificado: "verified",
  verified: "verified",
  tested: "tested",
  probado: "tested",
  working: "working",
  funciona: "working",
  cumple: "cumple",
});

function normalizeState(state) {
  if (typeof state !== "string") return undefined;
  const key = state.trim().toLowerCase();
  if (VERIFIED_ALIASES[key]) return VERIFIED_ALIASES[key];
  return key;
}

/**
 * ¿El estado declarado afirma verificación?
 * @param {string} state
 * @returns {boolean}
 */
function isVerifiedState(state) {
  const norm = normalizeState(state);
  return VERIFIED_STATES.includes(norm);
}

/**
 * Valida una declaración de evidencia.
 *
 * @param {object} declaration
 * @param {string} declaration.state         Estado declarado (verificado, no_ejecutado, ...).
 * @param {object} [declaration.evidence]    Evidencia asociada (contrato de evidence.js).
 * @param {object} [expectation]             { commit, scope, maxAgeHours } exigidos.
 * @param {object} [deps]                    { now } inyectable para pruebas.
 * @returns {{ ok: boolean, state: string, requiresEvidence: boolean, reason?: string }}
 */
function validateDeclaration(declaration, expectation = {}, deps = {}) {
  if (!declaration || typeof declaration !== "object") {
    return { ok: false, state: "invalid", requiresEvidence: false, reason: "declaración ausente" };
  }

  const normalized = normalizeState(declaration.state);
  if (!normalized) {
    return { ok: false, state: "invalid", requiresEvidence: false, reason: "estado no declarado" };
  }

  const requiresEvidence = VERIFIED_STATES.includes(normalized);

  // Estados honestos no requieren evidencia: se aceptan tal cual.
  if (!requiresEvidence) {
    return { ok: true, state: normalized, requiresEvidence: false };
  }

  // Estado verificado: fail-closed si no hay evidencia fresca y coincidente.
  if (declaration.evidence === undefined || declaration.evidence === null) {
    return {
      ok: false,
      state: normalized,
      requiresEvidence: true,
      reason: "un estado verificado requiere evidencia vigente y del mismo alcance",
    };
  }

  const support = supportsVerification(declaration.evidence, expectation, deps);
  if (!support.ok) {
    return {
      ok: false,
      state: normalized,
      requiresEvidence: true,
      reason: support.reason,
    };
  }

  return { ok: true, state: normalized, requiresEvidence: true };
}

module.exports = {
  VERIFIED_ALIASES,
  normalizeState,
  isVerifiedState,
  validateDeclaration,
};
