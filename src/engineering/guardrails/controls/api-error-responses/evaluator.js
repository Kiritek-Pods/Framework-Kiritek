"use strict";

/**
 * Evaluator puro de `api.error-responses` (T33). Determinista: contrato
 * inválido o incompleto y escenarios fallidos. Detectar handlers HTTP sin
 * contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de errores (ruta, JSON, ids únicos y schema api-error-responses.contract).",
  "contract-error-fields": "Con errorFormat custom, declare errorFields (los campos que todo error debe traer).",
  "validation-status": "Una entrada inválida debe responder 400 o 422, nunca 2xx ni 5xx.",
  "malformed-body": "Un cuerpo JSON mal formado debe responder 400, no 500.",
  "not-found-status": "Una ruta inexistente debe responder 404.",
  "internal-status": "Una falla interna debe responder 5xx controlado (no colgarse ni devolver 2xx).",
  "error-format": "Todos los errores deben seguir el formato declarado (application/problem+json o los campos de errorFields).",
  "no-internal-details": "Nunca exponga stack traces, rutas del servidor, SQL, IPs internas ni mensajes de dependencias en la respuesta.",
};
const SEVERITY = { "no-internal-details": "high", "malformed-body": "high", "validation-status": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "api.error-responses",
  prefix: "aer",
  paramName: "errorsContract",
  contractKind: "errors-contract",
  behaviorKind: "errors-behavior",
  signalsKind: "errors-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "errors-confirmation",
  heuristicRemediation: "API inferida por patrón: declare el contrato de errores (errorsContract). El patrón no prueba qué responde ante errores.",
  heuristicReason: "API sin contrato de errores: declárelo para verificar códigos, formato y que no se filtren detalles internos.",
  missingContractReason: "Falta el contrato de errores de API: no hay evidencia de qué responde ante entradas inválidas o fallas.",
  contractFindings: (facts) => (facts.errorFormat === "custom" && !facts.errorFields.length ? [{ rule: "contract-error-fields", subject: "format" }] : []),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
