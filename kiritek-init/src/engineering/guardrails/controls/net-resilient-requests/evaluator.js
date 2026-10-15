"use strict";

/**
 * Evaluator puro de `net.resilient-requests` (T20). Determinista: contrato
 * inválido o inseguro y escenarios conductuales fallidos. Detectar llamadas
 * HTTP sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const CONTROL = "net.resilient-requests";

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de llamadas (ruta, JSON, ids únicos y schema net-resilient-requests.contract).",
  "contract-timeout": "El timeoutMs de la operación supera parameters.maxTimeoutMs.",
  "contract-attempts": "maxAttempts supera parameters.maxAttempts: demasiados reintentos amplifican incidentes.",
  "contract-unsafe-retry": "Una operación no idempotente sin clave de idempotencia no puede reintentarse ante error de red o timeout (podría duplicar la operación).",
  "contract-backoff": "maxDelayMs no puede ser menor que baseMs.",
  timeout: "Toda llamada debe terminar: aplique el timeout declarado aunque el servidor no responda.",
  "client-error-retry": "No reintente errores del cliente (4xx): falle de inmediato con un único intento.",
  "transient-retry": "Reintente fallas transitorias (5xx, red) según la política declarada hasta tener éxito.",
  "retry-limit": "Respete maxAttempts: no reintente indefinidamente ni más veces de lo declarado.",
  backoff: "Espere entre reintentos según el backoff declarado (creciente si es exponencial, acotado por maxDelayMs).",
  "retry-after": "Ante 429, respete Retry-After antes de reintentar.",
  idempotency: "Tras un error ambiguo en una operación no idempotente, no reintente o reintente con la misma Idempotency-Key.",
};
const SEVERITY = { timeout: "high", idempotency: "high", "contract-unsafe-retry": "high", "retry-limit": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const out = [];
  for (const o of facts.operations) {
    if (params.maxTimeoutMs && o.timeoutMs > params.maxTimeoutMs) out.push({ rule: "contract-timeout", subject: o.id });
    if (params.maxAttempts && o.retry.maxAttempts > params.maxAttempts) out.push({ rule: "contract-attempts", subject: o.id });
    if (!o.idempotent && o.idempotencyKey === "none" && o.retry.maxAttempts > 1 && o.retry.on.some((k) => k === "network" || k === "timeout")) out.push({ rule: "contract-unsafe-retry", subject: o.id });
    if (o.retry.maxDelayMs !== undefined && o.retry.maxDelayMs < o.retry.baseMs) out.push({ rule: "contract-backoff", subject: o.id });
  }
  return out;
}

module.exports = makeEvaluator({
  control: CONTROL,
  prefix: "nrr",
  paramName: "clientContract",
  contractKind: "requests-contract",
  behaviorKind: "requests-behavior",
  signalsKind: "requests-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "requests-confirmation",
  heuristicRemediation: "Llamada HTTP inferida por patrón: declare la operación en el contrato de llamadas (clientContract). El patrón no prueba timeouts ni reintentos.",
  heuristicReason: "Llamadas de red sin contrato: declárelas para verificar timeouts, reintentos e idempotencia.",
  missingContractReason: "Falta el contrato de llamadas de red: no hay evidencia de timeouts ni de reintentos seguros.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
