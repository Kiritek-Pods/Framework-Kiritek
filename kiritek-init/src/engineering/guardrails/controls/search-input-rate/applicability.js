"use strict";

/**
 * Aplicabilidad de `search.input-rate` (T10; design §10.1). Pura.
 *
 * El perfil `search` ya fue exigido por el pipeline. Aquí:
 * - contrato válido o inválido declarado ⇒ aplicable determinista (el
 *   contrato es una declaración explícita y versionada del equipo);
 * - sin contrato ⇒ aplicable con confianza `medium`: se evalúa para pedir
 *   evidencia conductual (warn), pero jamás puede bloquear.
 * La búsqueda local sólo se vuelve N/A mediante N/A gobernado (pipeline).
 */

function applicability({ observations }) {
  const contract = observations.find((o) => o.kind === "search-contract");
  if (!contract) {
    return { status: "unknown", confidence: "unknown", reasons: [{ code: "CONTRACT_OBSERVATION_MISSING", message: "no se observó el contrato conductual" }] };
  }
  if (!contract.facts.declared) {
    return {
      status: "applicable",
      confidence: "medium",
      reasons: [{ code: "BEHAVIOR_CONTRACT_MISSING", message: "perfil search sin contrato conductual: se evalúa sólo para solicitar evidencia" }],
      sources: [contract.observationId],
    };
  }
  return { status: "applicable", confidence: "deterministic", reasons: [], sources: [contract.observationId] };
}

module.exports = { applicability };
