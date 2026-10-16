"use strict";

/**
 * Evaluator puro de `svc.health-shutdown` (T37). Determinista: contrato
 * inválido o con gracia excesiva y escenarios fallidos. Detectar el arranque
 * de un servidor sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de salud y apagado (ruta, JSON y schema svc-health-shutdown.contract).",
  "contract-grace": "shutdownGraceMs supera parameters.maxGraceMs: el orquestador mataría el proceso antes de terminar.",
  liveness: "La ruta de liveness debe responder 2xx mientras el proceso funciona.",
  readiness: "La ruta de readiness debe responder 2xx cuando las dependencias están sanas.",
  "readiness-checks-deps": "Si una dependencia declarada no responde, readiness debe responder 503 para que no le manden tráfico.",
  "liveness-independent": "Liveness no debe depender de las dependencias: si la base cae, reiniciar el proceso no lo arregla.",
  "drain-in-flight": "Al apagar, termine las requests en curso antes de cerrar.",
  "not-ready-on-shutdown": "Al empezar el apagado, readiness debe dejar de responder 2xx.",
  "reject-new-work": "Durante el apagado, rechace las requests nuevas (503) en vez de aceptarlas a medias.",
  "shutdown-completes": "El apagado debe terminar (cerrar conexiones y resolver) dentro del tiempo de gracia.",
  "grace-period": "Si hay trabajo que no termina, el apagado debe forzarse al vencer el tiempo de gracia, no quedar colgado.",
};
const SEVERITY = { "drain-in-flight": "high", "readiness-checks-deps": "high", "grace-period": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "svc.health-shutdown",
  prefix: "shs",
  paramName: "healthContract",
  contractKind: "health-contract",
  behaviorKind: "health-behavior",
  signalsKind: "health-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "health-confirmation",
  heuristicRemediation: "Servidor inferido por patrón: declare el contrato de salud y apagado (healthContract). El patrón no prueba readiness ni el apagado.",
  heuristicReason: "Servicio sin contrato de salud y apagado: declárelo para verificar liveness, readiness y apagado ordenado.",
  missingContractReason: "Falta el contrato de salud y apagado: no hay evidencia de que los despliegues no corten requests.",
  contractFindings: (facts, params) => (facts.shutdownGraceMs > (params.maxGraceMs || 30000) ? [{ rule: "contract-grace", subject: "shutdown" }] : []),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
