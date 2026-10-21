"use strict";

/**
 * Clasificación de incidentes de secreto del core de seguridad Kiritek.
 *
 * Dado un hallazgo redactado + contexto de exposición, decide la CLASE del
 * incidente y la severidad, y declara con honestidad las limitaciones que el
 * usuario debe conocer antes de reaccionar. No ejecuta ninguna acción
 * destructiva; sólo clasifica (función pura/determinista).
 *
 * Dos clases centrales (requisito 19.1):
 *  - `local-blocked`  : el secreto fue atrapado ANTES de publicar (staged /
 *                       pre-commit / pre-push bloqueado). No llegó al remoto.
 *  - `published`      : el secreto llegó al remoto o al historial (push
 *                       efectuado, visible en una rama remota, en un tag o en
 *                       commits anteriores). Exige revocación/rotación.
 *
 * Principios (G.12): el contrato NUNCA transporta el valor del secreto. Sólo
 * entra metadata redactada (regla, ruta relativa, fingerprint, severidad).
 */

const { assertNoForbiddenFields, SEVERITY, SEVERITIES, compareSeverity } = require("../domain/result.js");

/** Clases de incidente. */
const INCIDENT_CLASS = Object.freeze({
  LOCAL_BLOCKED: "local-blocked",
  PUBLISHED: "published",
});

/**
 * Dónde fue observado el secreto. Determina si llegó o no al remoto/historial.
 * `staged`/`pre-commit`/`pre-push-blocked` ⇒ bloqueado localmente.
 * El resto ⇒ publicado/histórico.
 */
const EXPOSURE = Object.freeze({
  STAGED: "staged",
  PRE_COMMIT_BLOCKED: "pre-commit-blocked",
  PRE_PUSH_BLOCKED: "pre-push-blocked",
  REMOTE_BRANCH: "remote-branch",
  REMOTE_DEFAULT: "remote-default",
  HISTORY: "history",
  TAG: "tag",
  CI_DETECTED: "ci-detected",
});

const LOCAL_EXPOSURES = Object.freeze([
  EXPOSURE.STAGED,
  EXPOSURE.PRE_COMMIT_BLOCKED,
  EXPOSURE.PRE_PUSH_BLOCKED,
]);

const PUBLISHED_EXPOSURES = Object.freeze([
  EXPOSURE.REMOTE_BRANCH,
  EXPOSURE.REMOTE_DEFAULT,
  EXPOSURE.HISTORY,
  EXPOSURE.TAG,
  EXPOSURE.CI_DETECTED,
]);

const EXPOSURES = Object.freeze([...LOCAL_EXPOSURES, ...PUBLISHED_EXPOSURES]);

/**
 * Pasos ordenados del runbook de respuesta (19.1). Son identificadores
 * estables; `runbook.js` los expande a texto accionable.
 */
const RESPONSE_STEPS = Object.freeze([
  "contain",
  "revoke-rotate",
  "assess-usage",
  "remove-from-code",
  "decide-history",
  "notify",
  "close",
]);

/**
 * Limitaciones honestas (19.2, G.10). NO son acciones: son declaraciones de lo
 * que ciertos actos NO logran, para evitar una falsa sensación de seguridad.
 */
const HONEST_LIMITATIONS = Object.freeze({
  DELETE_COMMIT_NOT_REVOKE:
    "Borrar el último commit (o reescribir el historial) NO revoca ni invalida la credencial expuesta: la rotación/revocación con el proveedor es obligatoria.",
  DEFAULT_BRANCH_NOT_FEATURE:
    "La protección IAM/rulesets sobre la rama default NO impide que un secreto llegue a una feature branch; el procedimiento se activa igual (19.3, 16.3, G.10).",
  LOCAL_HOOKS_NOT_ENOUGH:
    "Los hooks de cliente no pueden impedir todos los bypasses; el enforcement final depende de controles remotos.",
});

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} inválido: ${JSON.stringify(value)} (esperado uno de ${allowed.join(", ")})`);
  }
}

/**
 * Severidad base por tipo de proveedor/credencial declarado en el hallazgo.
 * Se usa sólo el `ruleId`/`provider` (metadato), nunca el valor.
 */
function baseSeverityFor(context) {
  const provider = (context.provider || context.ruleId || "").toLowerCase();
  // Credenciales de proveedor cloud/con privilegios amplios: alta por defecto.
  if (/aws|akia|gcp|google|azure|private[-_ ]?key|rsa|ssh/.test(provider)) {
    return SEVERITY.HIGH;
  }
  if (/token|pat|slack|github|jwt|api[-_ ]?key/.test(provider)) {
    return SEVERITY.MEDIUM;
  }
  return SEVERITY.MEDIUM;
}

/**
 * Eleva la severidad según exposición y entorno (sin bajarla nunca de la base).
 */
function escalateSeverity(base, { exposure, environment, privileged }) {
  let sev = base;
  const bump = (candidate) => {
    if (compareSeverity(candidate, sev) > 0) sev = candidate;
  };
  if (PUBLISHED_EXPOSURES.includes(exposure)) bump(SEVERITY.HIGH);
  if (exposure === EXPOSURE.REMOTE_DEFAULT || exposure === EXPOSURE.HISTORY) bump(SEVERITY.HIGH);
  if (privileged === true) bump(SEVERITY.CRITICAL);
  if (environment === "production" || environment === "prod") bump(SEVERITY.CRITICAL);
  return sev;
}

/**
 * Clasifica un incidente de secreto.
 *
 * @param {object} input
 * @param {object} [input.finding]   Hallazgo redactado (ruleId, path, fingerprint, severity).
 * @param {string} input.exposure    Uno de EXPOSURE.
 * @param {string} [input.branch]    Nombre de rama (metadato, no sensible).
 * @param {boolean} [input.isDefaultBranch] ¿La rama observada es la default?
 * @param {string} [input.provider]  Proveedor/credencial declarado (metadato).
 * @param {string} [input.environment] "production"|"staging"|... (metadato).
 * @param {boolean} [input.privileged] ¿Credencial de alto privilegio?
 * @returns {object} clasificación redactada + pasos + limitaciones.
 */
function classifyIncident(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("classifyIncident requiere un objeto");
  }
  assertNoForbiddenFields(input, "classifyIncident");
  if (input.finding) assertNoForbiddenFields(input.finding, "classifyIncident.finding");

  assertEnum(input.exposure, EXPOSURES, "exposure");

  const published = PUBLISHED_EXPOSURES.includes(input.exposure);
  const incidentClass = published ? INCIDENT_CLASS.PUBLISHED : INCIDENT_CLASS.LOCAL_BLOCKED;

  const base = input.finding && SEVERITIES.includes(input.finding.severity)
    ? input.finding.severity
    : baseSeverityFor(input);
  const severity = escalateSeverity(base, {
    exposure: input.exposure,
    environment: input.environment,
    privileged: input.privileged,
  });

  // Un incidente local-blocked no requiere rotación inmediata (el secreto no
  // salió), PERO si el valor ya se usó/commiteó localmente conviene revisarlo.
  // Un incidente published SIEMPRE requiere revocar/rotar.
  const requiresRotation = published;

  // La reescritura de historial sólo es relevante cuando el secreto ya está en
  // commits publicados o en el historial local que se compartirá.
  const historyRewriteRelevant =
    input.exposure === EXPOSURE.HISTORY ||
    input.exposure === EXPOSURE.REMOTE_BRANCH ||
    input.exposure === EXPOSURE.REMOTE_DEFAULT ||
    input.exposure === EXPOSURE.TAG;

  // Pasos: para local-blocked se omite revoke-rotate como obligatorio (se marca
  // condicional), pero el orden canónico se conserva para no perder guía.
  const steps = RESPONSE_STEPS.map((id) => ({
    id,
    required: stepRequired(id, { published, requiresRotation, historyRewriteRelevant }),
  }));

  // Limitaciones aplicables siempre que haya publicación o feature branch.
  const limitations = [];
  if (published) limitations.push(HONEST_LIMITATIONS.DELETE_COMMIT_NOT_REVOKE);
  if (
    input.exposure === EXPOSURE.REMOTE_BRANCH ||
    input.isDefaultBranch === false ||
    (input.branch && input.isDefaultBranch !== true)
  ) {
    limitations.push(HONEST_LIMITATIONS.DEFAULT_BRANCH_NOT_FEATURE);
  }
  limitations.push(HONEST_LIMITATIONS.LOCAL_HOOKS_NOT_ENOUGH);

  const classification = {
    incidentClass,
    published,
    exposure: input.exposure,
    severity,
    requiresRotation,
    historyRewriteRelevant,
    steps,
    limitations: dedupe(limitations),
  };
  if (input.finding) {
    // Sólo metadata redactada del hallazgo.
    classification.finding = {
      ruleId: input.finding.ruleId,
      path: input.finding.path,
      fingerprint: input.finding.fingerprint,
      severity: input.finding.severity,
    };
  }
  if (typeof input.branch === "string") classification.branch = input.branch;
  if (typeof input.environment === "string") classification.environment = input.environment;

  return Object.freeze(classification);
}

function stepRequired(id, { published, requiresRotation, historyRewriteRelevant }) {
  switch (id) {
    case "contain":
      return true;
    case "revoke-rotate":
      return requiresRotation; // obligatorio sólo si llegó al remoto/historial.
    case "assess-usage":
      return published;
    case "remove-from-code":
      return true;
    case "decide-history":
      return historyRewriteRelevant;
    case "notify":
      return published;
    case "close":
      return true;
    default:
      return true;
  }
}

function dedupe(arr) {
  return Array.from(new Set(arr));
}

module.exports = {
  INCIDENT_CLASS,
  EXPOSURE,
  EXPOSURES,
  LOCAL_EXPOSURES,
  PUBLISHED_EXPOSURES,
  RESPONSE_STEPS,
  HONEST_LIMITATIONS,
  classifyIncident,
};
