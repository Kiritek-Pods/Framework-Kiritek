"use strict";

/**
 * Evaluator puro de `ui.accessible-dialogs` (T31). Determinista: contrato
 * inválido y escenarios fallidos. Detectar modales sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de diálogos (ruta, JSON, ids únicos y schema ui-accessible-dialogs.contract).",
  "focus-in": "Al abrir, lleve el foco al diálogo o a su primer control.",
  "focus-trap": "Mientras el modal o panel está abierto, Tab y Shift+Tab deben quedar dentro.",
  "escape-close": "Escape debe cerrar un diálogo descartable (y no cerrar uno que no lo es).",
  "focus-return": "Al cerrar, devuelva el foco al botón que lo abrió.",
  "outside-click": "Clic afuera debe cerrar un diálogo descartable y no cerrar uno que no lo es.",
  role: "Use el rol correcto (dialog/alertdialog con aria-modal en modales; menu en menús).",
  "accessible-name": "Dé al diálogo un nombre accesible (aria-labelledby o aria-label).",
  "background-inert": "Con un modal o panel abierto, el fondo no debe poder usarse (inert o aria-hidden).",
};
const SEVERITY = { "focus-trap": "high", "escape-close": "high", "focus-in": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "ui.accessible-dialogs",
  prefix: "uad",
  paramName: "dialogsContract",
  contractKind: "dialogs-contract",
  behaviorKind: "dialogs-behavior",
  signalsKind: "dialogs-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "dialogs-confirmation",
  heuristicRemediation: "Diálogo inferido por patrón: declárelo en el contrato de diálogos (dialogsContract). El patrón no prueba el foco ni el teclado.",
  heuristicReason: "Diálogos sin contrato: declárelos para verificar foco, teclado y fondo inerte.",
  missingContractReason: "Falta el contrato de diálogos: no hay evidencia de accesibilidad de modales y menús.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
