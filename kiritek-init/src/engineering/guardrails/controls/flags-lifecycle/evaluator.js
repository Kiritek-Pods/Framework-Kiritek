"use strict";

/**
 * Evaluator puro de `flags.lifecycle` (T21). Determinista: registro inválido,
 * flags temporales vencidas o sin fecha de retiro, vida máxima excedida,
 * defaults inseguros y escenarios del cliente fallidos. Detectar uso de un
 * SDK de flags sin registro sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor, registryFindings, expiringSoon } = require("./scenarios.js");

const CONTROL = "flags.lifecycle";

const REMEDIATION = {
  "contract-invalid": "Corrija el registro de flags (ruta, JSON, keys únicas y schema flags-lifecycle.contract).",
  "contract-timeout": "El timeout del cliente de flags supera parameters.maxClientTimeoutMs.",
  "remove-by-missing": "Toda flag de release o experimento necesita fecha de retiro (removeBy).",
  "flag-expired": "La flag pasó su fecha de retiro: elimínela del código y del registro, o extienda removeBy con justificación (waiver).",
  "flag-lifetime": "La vida de la flag (createdAt → removeBy) supera parameters.maxLifetimeDays: acorte el plazo o conviértala en flag de ops.",
  "unsafe-default": "Las flags de permiso deben tener defaultValue false: si el proveedor falla, nadie gana acceso.",
  "kill-switch-type": "Un kill switch debe ser booleano para poder apagarse sin ambigüedad.",
  "provider-value": "El cliente debe usar el valor que entrega el proveedor.",
  "fallback-default": "Si el proveedor falla, devuelva el defaultValue declarado sin lanzar.",
  timeout: "Si el proveedor no responde dentro de client.timeoutMs, devuelva el defaultValue.",
  "invalid-value": "Si el proveedor devuelve un valor de tipo incorrecto, use el defaultValue.",
  "unknown-flag": "Una flag no registrada debe resolverse como apagada (false/null), nunca lanzar.",
  propagation: "Un cambio en el proveedor debe verse dentro de client.refreshSeconds (kill switch efectivo).",
};
const SEVERITY = { "unsafe-default": "high", "fallback-default": "high", timeout: "high", propagation: "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: CONTROL,
  prefix: "ffl",
  paramName: "flagRegistry",
  contractKind: "flags-registry",
  behaviorKind: "flags-behavior",
  signalsKind: "flags-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "registry-confirmation",
  heuristicRemediation: "Uso de feature flags inferido por patrón: declare las flags en el registro (flagRegistry) con dueño y fecha de retiro. El patrón no prueba el ciclo de vida.",
  heuristicReason: "Feature flags sin registro: declárelas con dueño, fecha de retiro y valor por defecto seguro.",
  missingContractReason: "Falta el registro de feature flags: no hay dueños, fechas de retiro ni defaults declarados.",
  contractFindings: registryFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
  allowReason: (facts, params, now) => {
    const n = expiringSoon(facts, params, now);
    return n ? `${n} flag(s) vencen en ≤ ${params.expiryWarningDays || 14} días: planifique su retiro.` : undefined;
  },
});
module.exports.REMEDIATION = REMEDIATION;
