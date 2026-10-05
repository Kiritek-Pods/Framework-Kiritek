"use strict";

/**
 * Contrato central de resultados del core de seguridad Kiritek.
 *
 * Un `PolicyResult` es la unidad que todo control (Gitleaks, hooks Git,
 * adaptadores Claude/Kiro, validador Jira, auditoría) produce y que los
 * adaptadores traducen a su mecanismo de bloqueo (exit code, permissionDecision).
 *
 * Diseño:
 * - Sin dependencias externas (requisito de supply chain 24).
 * - Los constructores validan combinaciones y rechazan estados inválidos,
 *   en vez de confiar en que quien llama arme el objeto correctamente.
 * - El esquema NO admite campos para secreto/match/línea fuente/prompt/código:
 *   el valor sensible nunca entra al contrato (requisitos 13.3–13.5, G.12).
 */

const SCHEMA_VERSION = 1;

/** Decisión de una evaluación de política. */
const DECISION = Object.freeze({
  ALLOW: "allow",
  WARN: "warn",
  DENY: "deny",
  ERROR: "error",
});

/** Severidad de un hallazgo o resultado. */
const SEVERITY = Object.freeze({
  INFO: "info",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

/** Estado de la herramienta externa (p. ej. Gitleaks) usada por el control. */
const TOOL_STATUS = Object.freeze({
  OK: "ok",
  UNAVAILABLE: "unavailable",
  INTEGRITY_FAILED: "integrity_failed",
  INCOMPATIBLE: "incompatible",
  NOT_APPLICABLE: "not_applicable",
});

/** Ciclo de vida de un hallazgo entre ejecuciones. */
const FINDING_STATUS = Object.freeze({
  NEW: "new",
  EXISTING: "existing",
  RESOLVED: "resolved",
  SUPPRESSED: "suppressed",
  ERROR: "error",
});

const DECISIONS = Object.freeze(Object.values(DECISION));
const SEVERITIES = Object.freeze(Object.values(SEVERITY));
const TOOL_STATUSES = Object.freeze(Object.values(TOOL_STATUS));
const FINDING_STATUSES = Object.freeze(Object.values(FINDING_STATUS));

const SEVERITY_RANK = Object.freeze({
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

/**
 * Campos prohibidos en cualquier objeto del contrato. Si aparecen, es un error
 * de programación: el valor sensible debe quedar fuera del modelo (G.12).
 */
const FORBIDDEN_FIELDS = Object.freeze([
  "secret",
  "secretValue",
  "match",
  "matchValue",
  "sourceLine",
  "line",
  "lineContent",
  "prompt",
  "code",
  "snippet",
  "rawContent",
  "value",
]);

function assertNoForbiddenFields(obj, where) {
  if (!obj || typeof obj !== "object") return;
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      throw new TypeError(
        `${where}: campo prohibido "${field}" — el valor sensible no debe entrar al contrato`
      );
    }
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} inválido: ${JSON.stringify(value)} (esperado uno de ${allowed.join(", ")})`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

/**
 * Compara dos severidades. Devuelve >0 si `a` es más severa que `b`.
 */
function compareSeverity(a, b) {
  assertEnum(a, SEVERITIES, "severity");
  assertEnum(b, SEVERITIES, "severity");
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

function maxSeverity(severities) {
  if (!Array.isArray(severities) || severities.length === 0) return SEVERITY.INFO;
  return severities.reduce((acc, s) => (compareSeverity(s, acc) > 0 ? s : acc), SEVERITY.INFO);
}

/**
 * Crea un hallazgo redactado. Nunca contiene el valor sensible: sólo metadatos
 * suficientes para localizar y remediar (regla, ruta relativa, número de línea).
 *
 * @param {object} input
 * @param {string} input.ruleId        Identificador de la regla que disparó.
 * @param {string} input.path          Ruta relativa al repo (sin escapes).
 * @param {number} [input.lineNumber]  Número de línea (no el contenido).
 * @param {string} input.severity      Severidad SEVERITY.
 * @param {string} input.fingerprint   Huella estable que NO revela el secreto.
 * @param {string} [input.status]      FINDING_STATUS, por defecto NEW.
 * @param {string} [input.remediation] Texto de remediación, sin valores.
 */
function createFinding(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("createFinding requiere un objeto");
  }
  assertNoForbiddenFields(input, "createFinding");

  assertNonEmptyString(input.ruleId, "finding.ruleId");
  assertNonEmptyString(input.path, "finding.path");
  assertNonEmptyString(input.fingerprint, "finding.fingerprint");
  assertEnum(input.severity, SEVERITIES, "finding.severity");

  const status = input.status === undefined ? FINDING_STATUS.NEW : input.status;
  assertEnum(status, FINDING_STATUSES, "finding.status");

  if (input.lineNumber !== undefined) {
    if (!Number.isInteger(input.lineNumber) || input.lineNumber < 1) {
      throw new TypeError("finding.lineNumber debe ser un entero >= 1");
    }
  }
  if (input.remediation !== undefined) {
    assertNonEmptyString(input.remediation, "finding.remediation");
  }

  const finding = {
    ruleId: input.ruleId,
    path: input.path,
    severity: input.severity,
    fingerprint: input.fingerprint,
    status,
  };
  if (input.lineNumber !== undefined) finding.lineNumber = input.lineNumber;
  if (input.remediation !== undefined) finding.remediation = input.remediation;

  return Object.freeze(finding);
}

/**
 * Crea un `PolicyResult` validado.
 *
 * Reglas de consistencia aplicadas:
 * - `deny`/`warn` requieren al menos un hallazgo o una razón explícita.
 * - `allow` no admite hallazgos (si hay hallazgos, no es un allow limpio).
 * - `error` exige `toolStatus` distinto de OK o una razón de error.
 * - La severidad del resultado no puede ser menor que la del hallazgo más severo.
 *
 * @param {object} input
 */
function createResult(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("createResult requiere un objeto");
  }
  assertNoForbiddenFields(input, "createResult");

  assertNonEmptyString(input.controlId, "result.controlId");
  assertEnum(input.decision, DECISIONS, "result.decision");

  const toolStatus = input.toolStatus === undefined ? TOOL_STATUS.NOT_APPLICABLE : input.toolStatus;
  assertEnum(toolStatus, TOOL_STATUSES, "result.toolStatus");

  const findings = input.findings === undefined ? [] : input.findings;
  if (!Array.isArray(findings)) {
    throw new TypeError("result.findings debe ser un arreglo");
  }
  const normalizedFindings = findings.map((f) =>
    // Si ya es un hallazgo congelado, se revalida igualmente para garantizar forma.
    createFinding(f)
  );

  const reason = input.reason;
  if (reason !== undefined) assertNonEmptyString(reason, "result.reason");

  const hasFindings = normalizedFindings.length > 0;

  if (input.decision === DECISION.ALLOW && hasFindings) {
    throw new TypeError("result.decision 'allow' no puede llevar hallazgos");
  }
  if ((input.decision === DECISION.DENY || input.decision === DECISION.WARN) && !hasFindings && !reason) {
    throw new TypeError(`result.decision '${input.decision}' requiere hallazgos o una razón`);
  }
  if (input.decision === DECISION.ERROR) {
    const toolSignalsError = toolStatus !== TOOL_STATUS.OK && toolStatus !== TOOL_STATUS.NOT_APPLICABLE;
    if (!toolSignalsError && !reason) {
      throw new TypeError("result.decision 'error' requiere toolStatus de error o una razón");
    }
  }

  const declaredSeverity = input.severity;
  if (declaredSeverity !== undefined) assertEnum(declaredSeverity, SEVERITIES, "result.severity");
  const findingSeverity = maxSeverity(normalizedFindings.map((f) => f.severity));
  const severity = declaredSeverity === undefined ? findingSeverity : declaredSeverity;
  if (hasFindings && compareSeverity(severity, findingSeverity) < 0) {
    throw new TypeError("result.severity no puede ser menor que la del hallazgo más severo");
  }

  if (input.scope !== undefined) assertNonEmptyString(input.scope, "result.scope");
  if (input.remediation !== undefined) assertNonEmptyString(input.remediation, "result.remediation");
  if (input.evidenceRef !== undefined) assertNonEmptyString(input.evidenceRef, "result.evidenceRef");

  const result = {
    schemaVersion: SCHEMA_VERSION,
    controlId: input.controlId,
    decision: input.decision,
    severity,
    toolStatus,
    findings: Object.freeze(normalizedFindings),
  };
  if (reason !== undefined) result.reason = reason;
  if (input.scope !== undefined) result.scope = input.scope;
  if (input.remediation !== undefined) result.remediation = input.remediation;
  if (input.evidenceRef !== undefined) result.evidenceRef = input.evidenceRef;

  return Object.freeze(result);
}

/**
 * ¿La decisión implica bloqueo en enforcement? Útil para los adaptadores.
 */
function isBlocking(decision) {
  assertEnum(decision, DECISIONS, "decision");
  return decision === DECISION.DENY || decision === DECISION.ERROR;
}

module.exports = {
  SCHEMA_VERSION,
  DECISION,
  SEVERITY,
  TOOL_STATUS,
  FINDING_STATUS,
  DECISIONS,
  SEVERITIES,
  TOOL_STATUSES,
  FINDING_STATUSES,
  createFinding,
  createResult,
  compareSeverity,
  maxSeverity,
  isBlocking,
  // Exportado para pruebas y para que otros contratos reutilicen la guardia.
  FORBIDDEN_FIELDS,
  assertNoForbiddenFields,
};
