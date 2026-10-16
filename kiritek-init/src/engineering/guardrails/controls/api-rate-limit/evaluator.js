"use strict";

/**
 * Evaluator puro de `api.rate-limit` (T34). Determinista: contrato inválido
 * y escenarios fallidos. Detectar endpoints públicos sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de límites (ruta, JSON, ids únicos y schema api-rate-limit.contract).",
  "under-limit": "Dentro del límite declarado, los pedidos no deben recibir 429.",
  "limit-enforced": "Superado el límite dentro de la ventana, responda 429.",
  "retry-after": "Junto con el 429, envíe Retry-After (segundos, entre 1 y la ventana).",
  "per-client": "Cuente el límite por cliente (clave, IP o usuario declarado): que un cliente lo agote no debe bloquear a otro.",
  "window-reset": "Pasada la ventana, el cliente debe poder volver a usar la API.",
};
const SEVERITY = { "limit-enforced": "high", "per-client": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "api.rate-limit",
  prefix: "arl",
  paramName: "rateLimitContract",
  contractKind: "ratelimit-contract",
  behaviorKind: "ratelimit-behavior",
  signalsKind: "ratelimit-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "ratelimit-confirmation",
  heuristicRemediation: "API inferida por patrón: declare sus límites de uso (rateLimitContract). El patrón no prueba que el límite se cumpla.",
  heuristicReason: "API sin contrato de límites de uso: declárelos para verificar 429, Retry-After y conteo por cliente.",
  missingContractReason: "Falta el contrato de límites de uso: no hay evidencia de protección contra abuso.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
