"use strict";

/**
 * Aplicabilidad común (pura) de los controles con contrato declarado: el
 * perfil ya lo exige el pipeline. Contrato declarado (válido o no) ⇒
 * aplicable determinista; sin contrato ⇒ aplicable `medium` sólo para pedir
 * evidencia (nunca bloquea).
 */
function contractApplicability(kind, missingCode, missingMessage) {
  return function applicability({ observations }) {
    const c = observations.find((o) => o.kind === kind);
    if (!c) return { status: "unknown", confidence: "unknown", reasons: [{ code: "CONTRACT_OBSERVATION_MISSING", message: "no se observó el contrato declarado" }] };
    if (!c.facts.declared) return { status: "applicable", confidence: "medium", reasons: [{ code: missingCode, message: missingMessage }], sources: [c.observationId] };
    return { status: "applicable", confidence: "deterministic", reasons: [], sources: [c.observationId] };
  };
}

module.exports = { contractApplicability };
