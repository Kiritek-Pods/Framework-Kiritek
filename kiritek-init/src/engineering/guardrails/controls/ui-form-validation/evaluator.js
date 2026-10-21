"use strict";

/**
 * Evaluator puro de `ui.form-validation` (T19). Determinista: contrato
 * inválido o incoherente y escenarios conductuales fallidos. Detectar
 * formularios sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const CONTROL = "ui.form-validation";

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de formularios (ruta, JSON, ids y nombres de campo únicos, schema ui-form-validation.contract).",
  "contract-length": "minLength no puede ser mayor que maxLength en un mismo campo.",
  "blocks-invalid-submit": "No envíe el formulario mientras haya campos obligatorios vacíos o con formato inválido.",
  required: "Marque como inválido cada campo obligatorio vacío al intentar enviar.",
  format: "Valide el formato y largo declarados de cada campo (email, número, URL, teléfono, largo de texto).",
  "false-error": "No marque como inválido un campo con un valor válido.",
  "error-linked": "Asocie cada mensaje de error a su campo (aria-describedby o equivalente) para que el lector de pantalla lo lea.",
  "focus-first-invalid": "Al fallar el envío, lleve el foco al primer campo inválido.",
  "message-text": "Los mensajes de error deben ser texto legible: nunca vacíos, claves internas ni markup.",
  submit: "Con todos los campos válidos, el formulario debe enviarse una vez, con los valores ingresados, y confirmar el envío.",
  "double-submit": "Evite envíos duplicados mientras un envío está en curso (deshabilite o ignore clics repetidos).",
  "preserve-input": "Si el envío falla, conserve lo que el usuario escribió.",
  "error-announced": "Si el envío falla, muestre y anuncie el error (live region o alerta) y deje el formulario en estado de error.",
  resubmit: "Tras un error de envío, el usuario debe poder reenviar y completar el envío.",
  "error-clears": "Al corregir un campo, quite su error.",
};
const SEVERITY = { "blocks-invalid-submit": "high", "preserve-input": "high", "double-submit": "high", "error-linked": "high", "contract-invalid": "high" };

function contractFindings(facts) {
  const out = [];
  for (const f of facts.forms) for (const x of f.fields) if (x.minLength && x.maxLength && x.minLength > x.maxLength) out.push({ rule: "contract-length", subject: `${f.id}.${x.name}` });
  return out;
}

module.exports = makeEvaluator({
  control: CONTROL,
  prefix: "ufv",
  paramName: "formsContract",
  contractKind: "forms-contract",
  behaviorKind: "forms-behavior",
  signalsKind: "forms-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "forms-confirmation",
  heuristicRemediation: "Formulario inferido por patrón: declárelo en el contrato de formularios (formsContract). El patrón no prueba la validación.",
  heuristicReason: "Formularios sin contrato: declárelos para verificar validación, errores accesibles y envío.",
  missingContractReason: "Falta el contrato de formularios: no hay evidencia de validación ni de errores accesibles.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
