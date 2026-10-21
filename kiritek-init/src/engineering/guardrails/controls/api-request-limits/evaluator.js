"use strict";

/**
 * Evaluator puro de `api.request-limits` (T41). Determinista: contrato
 * inválido o con límites por encima del máximo configurado y escenarios
 * fallidos (cuerpo excedido, timeout y cancelación). Detectar configuración
 * de parsers o timeouts sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de límites (ruta, JSON, ids únicos y schema api-request-limits.contract).",
  "contract-limits": "maxBodyBytes o timeoutMs superan los máximos configurados (parameters.maxBodyBytesLimit / maxTimeoutMsLimit).",
  "false-rejection": "Un cuerpo dentro del límite debe aceptarse.",
  "body-limit": "Rechace los cuerpos que superan maxBodyBytes (configure el límite del parser).",
  "body-limit-status": "Un cuerpo excedido debe responder 413 Payload Too Large.",
  "body-limit-unverified": "Mida el cuerpo recibido: sin Content-Length (chunked) el límite también debe aplicarse.",
  "processed-oversized": "Rechace el cuerpo excedido antes de procesarlo (sin llamar a la base ni a otros servicios).",
  "request-timeout": "Corte la request al vencer timeoutMs: una dependencia lenta no puede dejarla colgada.",
  "timeout-status": "Al vencer el timeout responda 503, 504 o 408, no 2xx ni 500.",
  "cancel-on-timeout": "Al vencer el timeout cancele el trabajo en curso (AbortSignal), para no seguir consumiendo recursos.",
  "premature-timeout": "Una dependencia que responde dentro de timeoutMs no debe cortarse antes.",
};
const SEVERITY = { "body-limit": "high", "request-timeout": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const out = [];
  if (facts.maxBodyBytes > (params.maxBodyBytesLimit || 10485760)) out.push({ rule: "contract-limits", subject: "body" });
  if (facts.timeoutMs > (params.maxTimeoutMsLimit || 30000)) out.push({ rule: "contract-limits", subject: "timeout" });
  return out;
}

module.exports = makeEvaluator({
  control: "api.request-limits",
  prefix: "arq",
  paramName: "limitsContract",
  contractKind: "limits-contract",
  behaviorKind: "limits-behavior",
  signalsKind: "limits-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "limits-confirmation",
  heuristicRemediation: "Configuración de límites inferida por patrón: declare el contrato de límites (limitsContract). El patrón no prueba que se apliquen.",
  heuristicReason: "Límites de request sin contrato: declárelos para verificar cuerpos excedidos y timeouts.",
  missingContractReason: "Falta el contrato de límites de request: no hay evidencia de que un cuerpo enorme o una dependencia lenta no tumben el servicio.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
