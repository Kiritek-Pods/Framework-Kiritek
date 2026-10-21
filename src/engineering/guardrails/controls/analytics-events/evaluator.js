"use strict";

/**
 * Evaluator puro de `analytics.events` (T25). Determinista: plan inválido,
 * propiedades del plan con nombre de dato personal y escenarios fallidos
 * (esquema, duplicados, fuga de PII, aislamiento de fallas). Detectar
 * llamadas de tracking sin plan sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor, piiProperties, DEFAULT_FORBIDDEN } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el plan de tracking (ruta, JSON, nombres únicos y schema analytics-events.contract).",
  "pii-property": "El plan declara una propiedad con nombre de dato personal (email, teléfono, nombre…): quítela o use un identificador seudónimo.",
  "emitted-once": "Cada acción debe emitir su evento exactamente una vez.",
  schema: "Envíe el evento con las propiedades obligatorias, del tipo declarado y con valores permitidos.",
  "unplanned-properties": "No envíe propiedades que no están en el plan de tracking.",
  "pii-leak": "No envíe datos personales del usuario (email, teléfono, nombre) en eventos de analytics.",
  "failure-isolation": "Si el envío de analytics falla, la acción del usuario debe seguir funcionando (no propague el error).",
  "duplicate-delivery": "Al reintentar envíos fallidos, no entregue el mismo evento dos veces.",
};
const SEVERITY = { "pii-leak": "high", "pii-property": "high", "failure-isolation": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "analytics.events",
  prefix: "ane",
  paramName: "trackingPlan",
  contractKind: "analytics-plan",
  behaviorKind: "analytics-behavior",
  signalsKind: "analytics-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "plan-confirmation",
  heuristicRemediation: "Tracking inferido por patrón: declare los eventos en el plan de tracking (trackingPlan). El patrón no prueba qué se envía.",
  heuristicReason: "Eventos de analytics sin plan: declárelos para verificar esquema, duplicados y privacidad.",
  missingContractReason: "Falta el plan de tracking: no hay evidencia de qué se envía a analytics.",
  contractFindings: (facts, params) => piiProperties(facts, params.forbiddenProperties || DEFAULT_FORBIDDEN).map((subject) => ({ rule: "pii-property", subject })),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
