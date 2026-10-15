"use strict";

/**
 * Evaluator puro de `auth.session-expiry` (T22). Determinista: contrato
 * inválido y escenarios fallidos. Detectar manejo de 401/tokens sin contrato
 * sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de sesión (ruta, JSON y schema auth-session-expiry.contract).",
  "contract-refresh": "parameters.requireRefresh exige renovación de token: declare session.refresh = token-refresh.",
  "authenticated-request": "Con una sesión válida, el pedido debe salir una vez con el token actual y sin renovar.",
  "refresh-retry": "Ante un 401, renueve el token y repita el pedido una vez con el token nuevo.",
  "single-refresh": "Si varios pedidos reciben 401 a la vez, renueve el token una sola vez y reintente todos con él.",
  "no-loop": "Si la renovación falla o el token nuevo también da 401, no reintente más: deje de pedir.",
  "login-redirect": "Si la sesión no se puede renovar, lleve al usuario al login (no a un error genérico ni a una pantalla rota).",
  "preserve-work": "Al llevar al login, conserve lo que el usuario estaba haciendo (borrador) para recuperarlo después.",
};
const SEVERITY = { "no-loop": "high", "preserve-work": "high", "single-refresh": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "auth.session-expiry",
  prefix: "ase",
  paramName: "sessionContract",
  contractKind: "session-contract",
  behaviorKind: "session-behavior",
  signalsKind: "session-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "session-confirmation",
  heuristicRemediation: "Manejo de sesión inferido por patrón: declare el contrato de sesión (sessionContract). El patrón no prueba qué pasa al expirar.",
  heuristicReason: "Manejo de sesión sin contrato: declárelo para verificar renovación, login y trabajo conservado.",
  missingContractReason: "Falta el contrato de sesión: no hay evidencia de qué pasa cuando la sesión expira.",
  contractFindings: (facts, params) => (params.requireRefresh && facts.session.refresh !== "token-refresh" ? [{ rule: "contract-refresh", subject: "session" }] : []),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
