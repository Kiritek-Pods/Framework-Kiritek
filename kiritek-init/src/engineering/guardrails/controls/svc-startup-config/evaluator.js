"use strict";

/**
 * Evaluator puro de `svc.startup-config` (T49). Determinista: contrato
 * inválido o incoherente y escenarios fallidos (arranque con configuración
 * válida, rechazo temprano de variables faltantes o inválidas con un error
 * que las nombra, opcionales que no se exigen y errores sin secretos).
 * Detectar lecturas del entorno sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de configuración (ruta, JSON, nombres únicos y schema svc-startup-config.contract).",
  "contract-enum-values": "Las variables de tipo enum deben declarar sus valores (values).",
  "valid-config-rejected": "Con todas las variables válidas el servicio debe arrancar.",
  "missing-not-detected": "Si falta una variable obligatoria, el servicio no debe arrancar (fail fast), en vez de fallar después en la primera request.",
  "invalid-not-detected": "Valide el formato de cada variable al arrancar (URL, número, valores permitidos) y niéguese a arrancar si es inválida.",
  "unhelpful-error": "El error de arranque debe nombrar la variable que falta o es inválida.",
  "optional-required": "Una variable opcional no debe impedir el arranque: use su valor por defecto.",
  "secret-in-config-error": "Los errores de configuración no deben mostrar valores de secretos (no imprima el entorno completo).",
};
const SEVERITY = { "missing-not-detected": "high", "secret-in-config-error": "high", "contract-invalid": "high" };

function contractFindings(facts) {
  return facts.variables.filter((v) => v.kind === "enum" && !(v.values && v.values.length)).map((v) => ({ rule: "contract-enum-values", subject: v.name }));
}

module.exports = makeEvaluator({
  control: "svc.startup-config",
  prefix: "ssc",
  paramName: "startupConfigContract",
  contractKind: "config-contract",
  behaviorKind: "config-behavior",
  signalsKind: "config-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "config-confirmation",
  heuristicRemediation: "Lectura del entorno inferida por patrón: declare las variables en el contrato de configuración (startupConfigContract).",
  heuristicReason: "Configuración por entorno sin contrato: declárela para verificar que el servicio falla al arrancar, no en producción.",
  missingContractReason: "Falta el contrato de configuración: no hay evidencia de que una variable faltante se detecte al arrancar.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
