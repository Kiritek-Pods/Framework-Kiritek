"use strict";

/**
 * Evaluator puro de `ui.file-upload` (T23). Determinista: contrato inválido
 * o demasiado permisivo y escenarios fallidos. Detectar inputs de archivo
 * sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de subidas (ruta, JSON, ids únicos y schema ui-file-upload.contract).",
  "contract-size": "maxBytes supera parameters.maxBytesLimit: baje el límite o súbalo explícitamente en la configuración.",
  "contract-accept-any": "Aceptar cualquier tipo (*/*) exige parameters.allowAnyType: declare los tipos concretos que acepta.",
  "upload-complete": "Un archivo válido debe subirse una vez y terminar en estado completado.",
  progress: "Muestre el progreso de la subida mientras ocurre.",
  "size-limit": "Rechace antes de subir los archivos que superan maxBytes, sin llamar al servidor.",
  "type-check": "Rechace antes de subir los tipos no aceptados, sin llamar al servidor.",
  "message-text": "Explique el rechazo con texto legible: nunca vacío, claves internas ni markup.",
  cancel: "Permita cancelar una subida en curso: aborte la transferencia y deje el estado en cancelado.",
  "error-state": "Si la subida falla, muestre un estado de error (no quede subiendo para siempre).",
  retry: "Tras un error, permita reintentar y completar la subida.",
  "duplicate-upload": "Ignore un segundo inicio mientras la subida está en curso (una sola transferencia).",
};
const SEVERITY = { "size-limit": "high", "type-check": "high", "duplicate-upload": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const out = [];
  const limit = params.maxBytesLimit || 104857600;
  for (const u of facts.uploads) {
    if (u.maxBytes > limit) out.push({ rule: "contract-size", subject: u.id });
    if (u.accept.includes("*/*") && !params.allowAnyType) out.push({ rule: "contract-accept-any", subject: u.id });
  }
  return out;
}

module.exports = makeEvaluator({
  control: "ui.file-upload",
  prefix: "ufu",
  paramName: "uploadsContract",
  contractKind: "uploads-contract",
  behaviorKind: "uploads-behavior",
  signalsKind: "uploads-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "uploads-confirmation",
  heuristicRemediation: "Subida de archivos inferida por patrón: declárela en el contrato de subidas (uploadsContract). El patrón no prueba límites ni progreso.",
  heuristicReason: "Subidas de archivos sin contrato: declárelas para verificar límites, progreso, cancelación y reintento.",
  missingContractReason: "Falta el contrato de subidas: no hay evidencia de límites de tamaño/tipo ni de progreso.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
