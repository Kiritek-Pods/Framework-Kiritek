"use strict";

/**
 * Evaluator puro de `api.pagination` (T35). Determinista: contrato inválido
 * o incoherente y escenarios fallidos. Detectar consultas de listado sin
 * contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de paginación (ruta, JSON, ids únicos y schema api-pagination.contract).",
  "contract-page-size": "maxPageSize supera parameters.maxPageSizeLimit, o defaultPageSize es mayor que maxPageSize.",
  "default-page-size": "Sin parámetros, el listado debe devolver defaultPageSize ítems.",
  "max-page-size": "Un limit mayor al máximo debe recortarse a maxPageSize o rechazarse con 4xx.",
  complete: "Recorriendo todas las páginas deben aparecer todos los ítems.",
  duplicates: "No repita ítems entre páginas.",
  order: "Conserve un orden estable entre páginas.",
  "end-detection": "Indique el final (cursor nulo o página incompleta) para no obligar a pedir de más.",
  "invalid-limit": "Un limit negativo o no numérico debe responder 4xx o usar el valor por defecto, nunca 5xx.",
  "stable-cursor": "Pagine por cursor: si llegan ítems nuevos, no repita ni salte ítems.",
  "invalid-cursor": "Un cursor inválido debe responder 400, no 500 ni una página arbitraria.",
};
const SEVERITY = { duplicates: "high", complete: "high", "max-page-size": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const limit = params.maxPageSizeLimit || 500;
  return facts.collections.filter((c) => c.maxPageSize > limit || c.defaultPageSize > c.maxPageSize).map((c) => ({ rule: "contract-page-size", subject: c.id }));
}

module.exports = makeEvaluator({
  control: "api.pagination",
  prefix: "apg",
  paramName: "paginationContract",
  contractKind: "apipage-contract",
  behaviorKind: "apipage-behavior",
  signalsKind: "apipage-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "pagination-confirmation",
  heuristicRemediation: "Endpoint de listado inferido por patrón: declárelo en el contrato de paginación (paginationContract). El patrón no prueba la paginación.",
  heuristicReason: "Listados sin contrato de paginación: declárelos para verificar tamaños, cursor y que no se repitan ni salten ítems.",
  missingContractReason: "Falta el contrato de paginación de API: no hay evidencia de que los listados estén acotados.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
