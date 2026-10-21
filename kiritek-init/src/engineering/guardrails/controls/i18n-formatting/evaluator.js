"use strict";

/**
 * Evaluator puro de `i18n.formatting` (T27). Determinista: contrato inválido
 * o incoherente y escenarios que no siguen las convenciones del idioma.
 * Detectar formatos fijos en el código sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de localización (ruta, JSON y schema i18n-formatting.contract).",
  "contract-default-locale": "defaultLocale debe estar entre los locales declarados.",
  "date-format": "Formatee fechas según el idioma del usuario (orden de día y mes, año completo); use Intl.DateTimeFormat o equivalente.",
  "number-format": "Formatee números con los separadores del idioma (p. ej. 1.234.567,89 en es-CL; 1,234,567.89 en en-US).",
  "currency-format": "Muestre montos con la moneda (símbolo o código) y el formato del idioma.",
  "time-zone": "Formatee fechas en la zona horaria del usuario, no en UTC ni en la del servidor.",
  "locale-fallback": "Si el idioma del usuario no está soportado, use el idioma por defecto.",
  "missing-message": "Si falta una traducción, muestre un texto de respaldo legible, nunca la clave interna ni un texto vacío.",
  "formatter-error": "El formateador no debe lanzar errores con ningún idioma soportado.",
};
const SEVERITY = { "time-zone": "high", "formatter-error": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "i18n.formatting",
  prefix: "i18",
  paramName: "i18nContract",
  contractKind: "i18n-contract",
  behaviorKind: "i18n-behavior",
  signalsKind: "i18n-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "i18n-confirmation",
  heuristicRemediation: "Formato fijo inferido por patrón (toFixed, fechas armadas a mano…): declare el contrato de localización (i18nContract). El patrón no prueba el formato mostrado.",
  heuristicReason: "Formatos sin contrato de localización: declárelo para verificar fechas, números y montos por idioma.",
  missingContractReason: "Falta el contrato de localización: no hay evidencia del formato por idioma.",
  contractFindings: (facts) => (facts.locales.includes(facts.defaultLocale) ? [] : [{ rule: "contract-default-locale", subject: "default" }]),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
