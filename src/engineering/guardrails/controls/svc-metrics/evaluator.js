"use strict";

/**
 * Evaluator puro de `svc.metrics` (T48). Determinista: contrato inválido y
 * escenarios fallidos (exposición, conteo de requests y errores, histograma
 * de latencia medido con el reloj, rutas como plantilla y labels sin datos
 * del usuario). Detectar librerías de métricas sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de métricas (ruta, JSON, ids únicos y schema svc-metrics.contract).",
  "metrics-endpoint": "Exponga metricsPath en formato Prometheus, con el contador de requests (counter) y el histograma de duración (histogram) declarados.",
  "request-count": "Cuente cada request en el contador declarado, con labels de ruta (la plantilla) y método.",
  "error-count": "Cuente también las requests que fallan, con su código 5xx en el label de status.",
  "latency-histogram": "Registre la duración de cada request en el histograma declarado (con bucket +Inf), medida con el reloj del servicio y en segundos.",
  "high-cardinality": "Use la plantilla de la ruta (/users/:id) como label, nunca la URL concreta: cada id distinto crea una serie nueva.",
  "pii-in-labels": "No ponga datos del usuario (ids, emails, tokens) en los labels de las métricas.",
};
const SEVERITY = { "high-cardinality": "high", "pii-in-labels": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "svc.metrics",
  prefix: "smt",
  paramName: "metricsContract",
  contractKind: "metrics-contract",
  behaviorKind: "metrics-behavior",
  signalsKind: "metrics-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "metrics-confirmation",
  heuristicRemediation: "Métricas inferidas por patrón: declare el contrato de métricas (metricsContract). El patrón no prueba qué se mide.",
  heuristicReason: "Métricas sin contrato: declárelo para verificar tráfico, errores y latencia por ruta sin cardinalidad explosiva.",
  missingContractReason: "Falta el contrato de métricas: no hay evidencia de que el servicio mida tráfico, errores y latencia.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
