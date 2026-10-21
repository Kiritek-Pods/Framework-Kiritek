"use strict";

/**
 * Evaluator puro de `app.device-permissions` (T29). Determinista: contrato
 * inválido y escenarios fallidos. Detectar pedidos de permiso sin contrato
 * sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de permisos (ruta, JSON, ids únicos y schema app-device-permissions.contract).",
  "ask-in-context": "No pida permisos al abrir la app: pídalos cuando el usuario usa la funcionalidad que los necesita.",
  rationale: "Explique para qué necesita el permiso antes de pedirlo.",
  "granted-flow": "Con el permiso concedido, la funcionalidad debe funcionar a la primera.",
  "denied-keeps-working": "Si el usuario niega el permiso, la app debe seguir funcionando (sin error ni bloqueo).",
  "denied-fallback": "Si el permiso se niega, ofrezca la alternativa declarada (p. ej. escribir la dirección a mano).",
  "no-reprompt": "No vuelva a pedir un permiso ya negado cada vez que se usa la funcionalidad.",
  "settings-link": "Si el permiso está bloqueado, ofrezca ir a los ajustes del sistema en vez de pedirlo de nuevo.",
};
const SEVERITY = { "ask-in-context": "high", "denied-keeps-working": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "app.device-permissions",
  prefix: "adp",
  paramName: "permissionsContract",
  contractKind: "permissions-contract",
  behaviorKind: "permissions-behavior",
  signalsKind: "permissions-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "permissions-confirmation",
  heuristicRemediation: "Pedido de permiso inferido por patrón: declárelo en el contrato de permisos (permissionsContract). El patrón no prueba cuándo ni cómo se pide.",
  heuristicReason: "Permisos del dispositivo sin contrato: declárelos para verificar cuándo se piden y qué pasa si se niegan.",
  missingContractReason: "Falta el contrato de permisos: no hay evidencia de qué pasa si el usuario los niega.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
