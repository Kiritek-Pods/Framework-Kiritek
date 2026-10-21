"use strict";

/**
 * Evaluator puro de `api.concurrency` (T39). Determinista: contrato inválido
 * y escenarios fallidos (versión expuesta, actualización condicional,
 * escritura obsoleta, precondición exigida y chequeo atómico). Detectar
 * endpoints de actualización sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de edición concurrente (ruta, JSON, ids únicos y schema api-concurrency.contract).",
  "version-exposed": "Exponga la versión del recurso al leerlo (header ETag o el campo de versión declarado).",
  "conditional-update": "Una actualización con la versión vigente debe aplicarse (2xx).",
  "version-advances": "Cada actualización debe cambiar la versión (ETag o campo de versión).",
  "stale-rejected": "Una actualización con una versión vieja debe responder 409 o 412.",
  "lost-update": "No sobrescriba cambios ajenos: compare la versión antes de guardar.",
  "precondition-required": "Exija la versión en cada actualización (428 o 4xx si falta), o declare requirePrecondition: false.",
  "atomic-check": "Compare y guarde en una sola operación atómica (UPDATE … WHERE version = ?, saveIfVersion): leer y luego guardar deja ganar a las dos escrituras.",
};
const SEVERITY = { "lost-update": "high", "atomic-check": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "api.concurrency",
  prefix: "acc",
  paramName: "concurrencyContract",
  contractKind: "concurrency-contract",
  behaviorKind: "concurrency-behavior",
  signalsKind: "concurrency-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "concurrency-confirmation",
  heuristicRemediation: "Endpoint de actualización inferido por patrón: declárelo en el contrato de edición concurrente (concurrencyContract). El patrón no prueba el control de versiones.",
  heuristicReason: "Actualizaciones sin contrato de edición concurrente: declárelas para verificar que nadie pise los cambios de otro.",
  missingContractReason: "Falta el contrato de edición concurrente: no hay evidencia de que las actualizaciones simultáneas no se pisen.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
