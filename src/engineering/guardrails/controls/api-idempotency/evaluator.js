"use strict";

/**
 * Evaluator puro de `api.idempotency` (T32). Determinista: contrato inválido
 * y escenarios fallidos. Detectar endpoints POST/PUT sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de idempotencia (ruta, JSON, ids únicos y schema api-idempotency.contract).",
  "single-execution": "Repetir un pedido con la misma clave de idempotencia no debe ejecutar el efecto otra vez.",
  "replay-same-response": "Un pedido repetido con la misma clave debe devolver la misma respuesta (estado y cuerpo) que el original.",
  "concurrent-single-execution": "Dos pedidos simultáneos con la misma clave deben ejecutar el efecto una sola vez (bloqueo o restricción única), sin error 5xx.",
  "distinct-keys": "Claves distintas son pedidos distintos: cada uno debe ejecutarse.",
  "key-mismatch": "Reutilizar una clave con otro cuerpo debe rechazarse (409/422), sin ejecutar nada.",
  "key-required": "Si la clave es obligatoria, rechace (400/428) los pedidos sin ella, sin ejecutar nada.",
};
const SEVERITY = { "single-execution": "high", "concurrent-single-execution": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "api.idempotency",
  prefix: "aid",
  paramName: "idempotencyContract",
  contractKind: "idempotency-contract",
  behaviorKind: "idempotency-behavior",
  signalsKind: "idempotency-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "idempotency-confirmation",
  heuristicRemediation: "Endpoint que modifica datos inferido por patrón: declárelo en el contrato de idempotencia (idempotencyContract). El patrón no prueba qué pasa al repetirlo.",
  heuristicReason: "Endpoints que modifican datos sin contrato: declárelos para verificar que repetirlos no duplica efectos.",
  missingContractReason: "Falta el contrato de idempotencia: no hay evidencia de qué pasa si un pedido se repite.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
