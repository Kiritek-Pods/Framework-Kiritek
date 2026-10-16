"use strict";

/**
 * Evaluator puro de `svc.dependency-failure` (T36). Determinista: contrato
 * inválido o con timeouts excesivos y escenarios fallidos. Detectar clientes
 * de bases o servicios sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de dependencias (ruta, JSON, ids únicos y schema svc-dependency-failure.contract).",
  "contract-timeout": "El timeoutMs de la dependencia supera parameters.maxTimeoutMs: las requests quedarían esperando demasiado.",
  "healthy-path": "Con todas las dependencias sanas, el endpoint debe responder 2xx.",
  "dependency-timeout": "Si una dependencia se cuelga, corte la espera en su timeoutMs y responda; nunca deje la request colgada.",
  "failure-response": "Si una dependencia falla, responda 503/504 controlado (o degradado 2xx si así se declaró), no 500 ni una excepción.",
  "circuit-breaker": "Tras fallas repetidas, deje de llamar a la dependencia caída por un tiempo (circuit breaker).",
  "breaker-recovery": "Cuando la dependencia se recupera, el corte debe cerrarse y el endpoint volver a responder 2xx.",
};
const SEVERITY = { "dependency-timeout": "high", "circuit-breaker": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "svc.dependency-failure",
  prefix: "sdf",
  paramName: "dependencyContract",
  contractKind: "deps-contract",
  behaviorKind: "deps-behavior",
  signalsKind: "deps-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "dependency-confirmation",
  heuristicRemediation: "Dependencia externa inferida por patrón: declárela en el contrato (dependencyContract). El patrón no prueba timeouts ni cortes.",
  heuristicReason: "Dependencias externas sin contrato: declárelas para verificar timeouts, respuesta ante fallas y circuit breaker.",
  missingContractReason: "Falta el contrato de dependencias: no hay evidencia de qué pasa si una base o servicio externo cae.",
  contractFindings: (facts, params) => facts.dependencies.filter((d) => d.timeoutMs > (params.maxTimeoutMs || 10000)).map((d) => ({ rule: "contract-timeout", subject: d.id })),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
