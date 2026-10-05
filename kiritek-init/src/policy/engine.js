"use strict";

/**
 * Motor de políticas puro del core de seguridad.
 *
 * Recibe un `PolicyInput` normalizado (ver domain/policy.js) y devuelve un
 * `PolicyResult` (ver domain/result.js). Es determinista y no hace E/S: los
 * datos (contenido de archivos, resultados de herramientas) los recolecta el
 * adaptador y se pasan como parte del input.
 *
 * Reglas aplicadas en esta tarea (M2 inicial):
 *  - Protección de archivos sensibles por ruta + contenido.
 *  - Excepciones vigentes por fingerprint/ruta (no allowlist global).
 *  - En enforce, un `error` no se degrada a `allow` salvo fallback explícito.
 *  - Los mensajes nunca incluyen el valor sensible.
 *
 * (Requisitos 5.1–5.6, 6.3–6.4, 11, 13, 20.3, 28, G.4, G.12.)
 */

const result = require("../domain/result.js");
const files = require("./files.js");
const exceptionDomain = require("../domain/exception.js");
const { buildFingerprint } = require("../scanners/fingerprint.js");

const CONTROL_ID = "files.sensitive";

/**
 * Evalúa archivos sensibles para un conjunto de rutas con contenido opcional.
 *
 * @param {object} input   PolicyInput extendido con `files: [{ path, content }]`.
 * @param {object} [opts]  { exceptions: [], now }
 * @returns {object} PolicyResult
 */
function evaluateFiles(input, opts = {}) {
  const mode = input.mode;
  const exceptions = opts.exceptions || [];
  const now = opts.now;

  const findings = [];
  const remediations = new Set();

  for (const f of input.files || []) {
    const evalResult = files.evaluateFile(f.path, f.content);
    if (!evalResult.sensitive) continue;

    const fingerprint = buildFingerprint({ path: f.path, ruleId: evalResult.category });

    // ¿Hay una excepción vigente que cubra este hallazgo?
    const covered = exceptions.some((exc) =>
      exceptionDomain.covers(exc, { fingerprint, path: f.path }, now ? { now } : {})
    );
    if (covered) continue;

    findings.push(
      result.createFinding({
        ruleId: evalResult.category,
        path: f.path,
        severity: severityFor(evalResult),
        fingerprint,
        remediation: remediationFor(evalResult),
      })
    );
    remediations.add(remediationFor(evalResult));
  }

  if (findings.length === 0) {
    return result.createResult({
      controlId: CONTROL_ID,
      decision: result.DECISION.ALLOW,
      toolStatus: result.TOOL_STATUS.NOT_APPLICABLE,
      scope: input.event,
    });
  }

  // deny en enforce; warn en warning.
  const decision = mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;
  return result.createResult({
    controlId: CONTROL_ID,
    decision,
    toolStatus: result.TOOL_STATUS.OK,
    findings,
    reason: "archivos sensibles detectados",
    remediation: [...remediations].join(" "),
    scope: input.event,
  });
}

function severityFor(evalResult) {
  if (evalResult.category === files.CATEGORY.PRIVATE_KEY || evalResult.category === files.CATEGORY.CREDENTIALS) {
    return result.SEVERITY.CRITICAL;
  }
  if (evalResult.contentHasSecret) return result.SEVERITY.CRITICAL;
  return result.SEVERITY.HIGH;
}

function remediationFor(evalResult) {
  if (evalResult.isExample) {
    return "El archivo de ejemplo contiene material que parece real; usa placeholders (YOUR_API_KEY).";
  }
  return "No versiones credenciales; usa un secret manager y agrega la ruta a .gitignore.";
}

/**
 * Envuelve una evaluación que podría fallar, garantizando que en enforce un
 * error NO se convierte en allow. Si el evaluador lanza, se devuelve `error`.
 *
 * @param {() => object} evaluator  Devuelve un PolicyResult.
 * @param {string} mode
 * @param {object} [fallback]       { allowOnError: boolean } explícito.
 */
function evaluateSafely(evaluator, mode, fallback = {}) {
  try {
    return evaluator();
  } catch (err) {
    if (mode !== "enforce" && fallback.allowOnError === true) {
      return result.createResult({
        controlId: CONTROL_ID,
        decision: result.DECISION.WARN,
        toolStatus: result.TOOL_STATUS.OK,
        reason: `evaluación falló, continuando con advertencia: ${err.message}`,
        scope: "unknown",
      });
    }
    return result.createResult({
      controlId: CONTROL_ID,
      decision: result.DECISION.ERROR,
      toolStatus: result.TOOL_STATUS.UNAVAILABLE,
      reason: `evaluación falló: ${err.message}`,
    });
  }
}

module.exports = {
  CONTROL_ID,
  evaluateFiles,
  evaluateSafely,
  severityFor,
  remediationFor,
};
