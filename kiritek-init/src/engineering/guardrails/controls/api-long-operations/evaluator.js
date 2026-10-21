"use strict";

/**
 * Evaluator puro de `api.long-operations` (T44). Determinista: contrato
 * inválido o con duraciones excesivas y escenarios fallidos (202 con URL de
 * estado, operación que termina, falla informada sin fugas, timeout con
 * cancelación y operación inexistente). Detectar colas o 202 sin contrato
 * sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de operaciones largas (ruta, JSON, ids únicos y schema api-long-operations.contract).",
  "contract-duration": "maxDurationMs supera parameters.maxDurationLimitMs.",
  "not-async": "Una operación larga debe responder 202 enseguida y seguir en segundo plano, no hacer esperar al cliente.",
  "status-location": "Responda 202 con la URL de estado en el header Location.",
  "never-completes": "Cuando el trabajo termina, el estado debe pasar al valor final declarado (doneValue).",
  "failure-not-reported": "Si el trabajo falla, el estado debe pasar a failedValue, no quedar 'en proceso' ni marcarse exitoso.",
  "failure-leak": "El estado de una operación fallida no debe exponer detalles internos (stack, rutas, mensajes crudos).",
  "stuck-forever": "Una operación que no termina debe marcarse fallida al vencer maxDurationMs.",
  "not-cancelled": "Al vencer maxDurationMs cancele el trabajo (AbortSignal), no lo deje corriendo.",
  "unknown-operation": "El estado de una operación inexistente debe responder 404.",
};
const SEVERITY = { "stuck-forever": "high", "failure-not-reported": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const limit = params.maxDurationLimitMs || 3600000;
  return facts.operations.filter((o) => o.maxDurationMs > limit).map((o) => ({ rule: "contract-duration", subject: o.id }));
}

module.exports = makeEvaluator({
  control: "api.long-operations",
  prefix: "alo",
  paramName: "operationsContract",
  contractKind: "longops-contract",
  behaviorKind: "longops-behavior",
  signalsKind: "longops-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "operations-confirmation",
  heuristicRemediation: "Operación asíncrona inferida por patrón: declárela en el contrato de operaciones largas (operationsContract). El patrón no prueba que termine ni que informe fallas.",
  heuristicReason: "Operaciones en segundo plano sin contrato: declárelas para verificar 202, estado consultable y que nada quede 'en proceso' para siempre.",
  missingContractReason: "Falta el contrato de operaciones largas: no hay evidencia de que las operaciones informen su resultado.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
