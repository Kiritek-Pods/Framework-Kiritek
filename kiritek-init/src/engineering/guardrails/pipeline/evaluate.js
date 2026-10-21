"use strict";

/**
 * Ejecución del evaluator puro (T06.2, T06.7).
 *
 * - Recibe sólo el `PracticeInput` congelado (reloj como valor); no tiene
 *   acceso a collectors, filesystem ni red por contrato.
 * - Por defecto se ejecuta dos veces y se compara: una salida no
 *   determinista es error operativo, nunca decisión.
 * - La clase de evidencia de cada finding NO se toma del evaluator: se
 *   recalcula desde las observaciones que cita. Un finding "determinista"
 *   sin observaciones completas y deterministas que lo respalden pasa a
 *   heurístico, y los heurísticos llevan remediación que declara la
 *   incertidumbre (R8.6).
 */

const { canonicalJson } = require("../canonical.js");
const { createEngineeringPolicyResult, DECISION } = require("../contracts/policy-result.js");
const { EVIDENCE_CLASS, assertNoForbiddenFieldsDeep } = require("../contracts/common.js");

const OUTPUT_KEYS = ["decision", "reason", "severity", "findings"];
const FINDING_KEYS = ["ruleId", "path", "severity", "fingerprint", "lineNumber", "remediation", "evidenceClass", "observationRefs"];
const HEURISTIC_REMEDIATION =
  "Señal heurística (no prueba comportamiento): confirme con un test contractual o descártela; nunca bloquea por sí sola.";

class EvaluatorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function validateOutput(output, controlId) {
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", "salida del evaluator no es un objeto");
  for (const k of Object.keys(output)) if (!OUTPUT_KEYS.includes(k)) throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", `campo no permitido "${k}" en salida del evaluator`);
  if (!Object.values(DECISION).includes(output.decision)) throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", "decisión inválida");
  const findings = output.findings || [];
  if (!Array.isArray(findings)) throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", "findings debe ser arreglo");
  for (const f of findings) {
    if (!f || typeof f !== "object") throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", "finding inválido");
    for (const k of Object.keys(f)) if (!FINDING_KEYS.includes(k)) throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", `campo no permitido "${k}" en finding`);
    if (!Object.values(EVIDENCE_CLASS).includes(f.evidenceClass)) throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", "finding sin evidenceClass válido");
  }
  try {
    assertNoForbiddenFieldsDeep({ ...output, findings: findings.map(({ ruleId, path, ...rest }) => rest) }, `evaluator ${controlId}`);
  } catch (err) {
    throw new EvaluatorError("EVALUATOR_FORBIDDEN_FIELD", "el evaluator emitió un campo prohibido (dato sensible)");
  }
}

/** Clase efectiva de un finding a partir de las observaciones que cita. */
function effectiveFindingClass(finding, observationsById, allowedClasses) {
  if (finding.evidenceClass === EVIDENCE_CLASS.HEURISTIC) return EVIDENCE_CLASS.HEURISTIC;
  const refs = finding.observationRefs || [];
  if (refs.length === 0) return EVIDENCE_CLASS.HEURISTIC;
  const obs = refs.map((r) => observationsById.get(r));
  if (obs.some((o) => !o || o.status !== "complete")) return EVIDENCE_CLASS.HEURISTIC;
  if (finding.evidenceClass === EVIDENCE_CLASS.MANUAL) {
    return obs.every((o) => o.evidenceClass === EVIDENCE_CLASS.MANUAL) && allowedClasses.includes(EVIDENCE_CLASS.MANUAL)
      ? EVIDENCE_CLASS.MANUAL
      : EVIDENCE_CLASS.HEURISTIC;
  }
  return obs.every((o) => o.evidenceClass === EVIDENCE_CLASS.DETERMINISTIC && o.confidence === "deterministic")
    ? EVIDENCE_CLASS.DETERMINISTIC
    : EVIDENCE_CLASS.HEURISTIC;
}

/**
 * @param {{version, evaluate: (input) => object}} evaluator
 * @param {object} practiceInput  PracticeInput congelado.
 * @param {object} opts { verifyDeterminism=true, allowedEvidenceClasses }
 * @returns {{result, findingEvidence, reclassified: string[]}}
 */
function runEvaluator(evaluator, practiceInput, opts = {}) {
  const controlId = practiceInput.control.id;
  let output;
  try {
    output = evaluator.evaluate(practiceInput);
    if (opts.verifyDeterminism !== false) {
      const second = evaluator.evaluate(practiceInput);
      if (canonicalJson(second) !== canonicalJson(output)) {
        throw new EvaluatorError("EVALUATOR_NONDETERMINISTIC", "el evaluator produjo salidas distintas con la misma entrada");
      }
    }
  } catch (err) {
    if (err instanceof EvaluatorError) throw err;
    throw new EvaluatorError("EVALUATOR_ERROR", "el evaluator lanzó una excepción");
  }
  if (output && typeof output.then === "function") throw new EvaluatorError("EVALUATOR_NOT_PURE", "el evaluator debe ser síncrono y puro");
  validateOutput(output, controlId);

  const byId = new Map(practiceInput.observations.map((o) => [o.observationId, o]));
  const allowed = opts.allowedEvidenceClasses || [EVIDENCE_CLASS.DETERMINISTIC];
  const reclassified = [];
  const findingEvidence = [];
  const findings = (output.findings || []).map((f) => {
    const cls = effectiveFindingClass(f, byId, allowed);
    if (cls !== f.evidenceClass) reclassified.push(f.fingerprint);
    findingEvidence.push({ fingerprint: f.fingerprint, evidenceClass: cls });
    const out = { ruleId: f.ruleId, path: f.path, severity: f.severity, fingerprint: f.fingerprint };
    if (f.lineNumber !== undefined) out.lineNumber = f.lineNumber;
    if (cls === EVIDENCE_CLASS.HEURISTIC) out.remediation = f.remediation ? `${f.remediation} — ${HEURISTIC_REMEDIATION}` : HEURISTIC_REMEDIATION;
    else if (f.remediation !== undefined) out.remediation = f.remediation;
    return out;
  });
  let result;
  try {
    result = createEngineeringPolicyResult({
      controlId,
      decision: output.decision,
      toolStatus: "ok",
      findings,
      ...(output.reason !== undefined ? { reason: output.reason } : {}),
      ...(output.severity !== undefined ? { severity: output.severity } : {}),
    });
  } catch (err) {
    throw new EvaluatorError("EVALUATOR_OUTPUT_INVALID", `resultado inválido: ${err.message}`);
  }
  return { result, findingEvidence, reclassified };
}

module.exports = { EvaluatorError, HEURISTIC_REMEDIATION, runEvaluator, effectiveFindingClass };
