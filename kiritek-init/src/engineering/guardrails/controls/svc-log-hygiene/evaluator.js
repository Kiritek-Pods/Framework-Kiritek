"use strict";

/**
 * Evaluator puro de `svc.log-hygiene` (T38). Determinista: contrato inválido
 * y escenarios fallidos (formato, correlación, datos personales o secretos en
 * los logs). Detectar llamadas a loggers sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de logs (ruta, JSON, ids únicos y schema svc-log-hygiene.contract).",
  "structured-logs": "Emita logs estructurados (una línea JSON por evento) con los campos de nivel y mensaje declarados.",
  "correlation-propagated": "Use el id de correlación que llega en el header declarado en todas las líneas de esa request.",
  "correlation-generated": "Si la request no trae id de correlación, genere uno y úselo en todas sus líneas.",
  "pii-in-logs": "No registre datos personales (email, teléfono, tarjeta): redáctelos o registre sólo identificadores seudónimos.",
  "secret-in-logs": "No registre secretos (tokens, cookies, contraseñas), ni en los mensajes de error: configure la redacción del logger.",
  "error-logged": "Cuando una dependencia falla, registre un evento de nivel error.",
};
const SEVERITY = { "pii-in-logs": "high", "secret-in-logs": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "svc.log-hygiene",
  prefix: "slh",
  paramName: "logsContract",
  contractKind: "logs-contract",
  behaviorKind: "logs-behavior",
  signalsKind: "logs-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "logs-confirmation",
  heuristicRemediation: "Logging inferido por patrón: declare el contrato de logs (logsContract). El patrón no prueba qué se registra.",
  heuristicReason: "Logs sin contrato: declárelo para verificar formato, correlación y que no se registren datos personales.",
  missingContractReason: "Falta el contrato de logs: no hay evidencia de que los logs no contengan datos personales.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
