"use strict";

/**
 * Evaluator puro de `ui.destructive-actions` (T26). Determinista: contrato
 * inválido, ventana de deshacer demasiado corta y escenarios fallidos.
 * Detectar botones de borrar/pagar sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor, undoes } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de acciones destructivas (ruta, JSON, ids únicos y schema ui-destructive-actions.contract).",
  "contract-undo-window": "La ventana para deshacer (undoWindowMs) debe declararse y ser al menos parameters.minUndoWindowMs.",
  confirmation: "Pida confirmación antes de ejecutar la acción destructiva; no ejecute al primer clic.",
  dismiss: "Si el usuario cancela la confirmación, no ejecute nada.",
  execute: "Confirmada (o vencida la ventana de deshacer), la acción debe ejecutarse una vez y mostrar el resultado con un mensaje legible.",
  "double-execution": "Ignore clics repetidos mientras la acción está en curso: debe ejecutarse una sola vez.",
  undo: "Deshacer dentro de la ventana debe dejar todo como estaba (no ejecutar, o revertir).",
  "undo-window": "Pasada la ventana de deshacer, la acción debe quedar aplicada.",
  "error-state": "Si la acción falla, muéstrelo como error y no la dé por hecha.",
  "message-text": "Informe el resultado con texto legible: nunca vacío, claves internas ni markup.",
};
const SEVERITY = { confirmation: "high", dismiss: "high", "double-execution": "high", undo: "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const min = params.minUndoWindowMs === undefined ? 3000 : params.minUndoWindowMs;
  return facts.actions.filter((a) => undoes(a) && (a.undoWindowMs === undefined || a.undoWindowMs < min)).map((a) => ({ rule: "contract-undo-window", subject: a.id }));
}

module.exports = makeEvaluator({
  control: "ui.destructive-actions",
  prefix: "uda",
  paramName: "actionsContract",
  contractKind: "actions-contract",
  behaviorKind: "actions-behavior",
  signalsKind: "actions-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "actions-confirmation",
  heuristicRemediation: "Acción destructiva inferida por patrón: declárela en el contrato (actionsContract). El patrón no prueba la confirmación ni el deshacer.",
  heuristicReason: "Acciones destructivas sin contrato: declárelas para verificar confirmación, deshacer y ejecución única.",
  missingContractReason: "Falta el contrato de acciones destructivas: no hay evidencia de confirmación ni de deshacer.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
