"use strict";

/**
 * Aplicabilidad (pura): perfil `mobile-app` ya exigido por el pipeline.
 * Contrato declarado (válido o no) ⇒ aplicable determinista; sin contrato ⇒
 * aplicable `medium` sólo para pedir evidencia (nunca bloquea).
 */
function applicability({ observations }) {
  const c = observations.find((o) => o.kind === "version-contract");
  if (!c) return { status: "unknown", confidence: "unknown", reasons: [{ code: "CONTRACT_OBSERVATION_MISSING", message: "no se observó el contrato de política" }] };
  if (!c.facts.declared) {
    return {
      status: "applicable",
      confidence: "medium",
      reasons: [{ code: "POLICY_CONTRACT_MISSING", message: "perfil mobile-app sin contrato de política de versión mínima" }],
      sources: [c.observationId],
    };
  }
  return { status: "applicable", confidence: "deterministic", reasons: [], sources: [c.observationId] };
}

module.exports = { applicability };
