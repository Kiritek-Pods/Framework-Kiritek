"use strict";

/**
 * Evaluator puro de `api.batch` (T45). Determinista: contrato inválido o con
 * topes excesivos y escenarios fallidos (resultados por ítem, éxito parcial
 * explícito o todo-o-nada real, tope y lote vacío). Detectar endpoints bulk
 * sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de operaciones en lote (ruta, JSON, ids únicos y schema api-batch.contract).",
  "contract-batch-size": "maxItems supera parameters.maxBatchItemsLimit.",
  "batch-results": "Responda un resultado por ítem, en el mismo orden y con su referencia (refField).",
  "batch-not-applied": "Un lote válido debe aplicar todos sus ítems.",
  "silent-failure": "Informe qué ítem falló: en modo partial, un resultado con error para ese ítem; en modo atomic, una respuesta de error.",
  "partial-lost": "En modo partial, un ítem malo no debe impedir aplicar los demás ni aplicarse a medias.",
  "not-atomic": "En modo atomic, si un ítem falla no debe quedar ninguno aplicado (use una transacción).",
  "batch-limit": "Un lote con más de maxItems ítems debe rechazarse con 4xx sin aplicar nada.",
  "empty-batch": "Un lote vacío debe responder 2xx vacío o 4xx, nunca 5xx.",
};
const SEVERITY = { "not-atomic": "high", "silent-failure": "high", "partial-lost": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const limit = params.maxBatchItemsLimit || 1000;
  return facts.endpoints.filter((e) => e.maxItems > limit).map((e) => ({ rule: "contract-batch-size", subject: e.id }));
}

module.exports = makeEvaluator({
  control: "api.batch",
  prefix: "abt",
  paramName: "batchContract",
  contractKind: "batch-contract",
  behaviorKind: "batch-behavior",
  signalsKind: "batch-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "batch-confirmation",
  heuristicRemediation: "Endpoint de lote inferido por patrón: declárelo en el contrato de operaciones en lote (batchContract). El patrón no prueba cómo maneja las fallas.",
  heuristicReason: "Operaciones en lote sin contrato: declárelas para verificar resultados por ítem y fallas parciales explícitas.",
  missingContractReason: "Falta el contrato de operaciones en lote: no hay evidencia de qué pasa cuando falla un ítem.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
