"use strict";

/**
 * Adaptador de scanners móviles (OWASP Mobile) al contrato común del core.
 *
 * El pack Flutter conserva controles ESPECIALIZADOS móviles (dependencias M2,
 * red M5, almacenamiento M9 y la guía manual M3/M4/M6/M7/M8/M10). Esos scanners
 * son procesos Python que emiten JSON propio. Este adaptador:
 *
 *  1. Normaliza su salida a `PolicyResult`/`Finding` del core (misma interfaz de
 *     resultados, severidad, redacción y evidencia que cualquier otro control —
 *     requisito 12.6).
 *  2. Pasa TODO por el redactor obligatorio: el campo `code`/`pattern` de cada
 *     hallazgo móvil (que puede contener la línea fuente, una URL con
 *     credenciales o un payload) nunca entra al contrato en claro (12.3, G.12).
 *  3. Declara `not_applicable` fuera de Flutter en vez de "fallido" (12.5).
 *  4. NO reimplementa el gate genérico de secretos: ése vive sólo en el core
 *     (Gitleaks). El control M1 del pack delega al core (G.7).
 *
 * El valor sensible nunca cruza este módulo hacia el contrato: del hallazgo
 * móvil sólo se conservan metadatos (categoría OWASP, ruta relativa, línea,
 * severidad, remediación) y un fingerprint estable derivado de la ubicación.
 *
 * (Requisitos 12.1–12.6, 13.3, 26.6, G.7, G.12.)
 */

const result = require("../domain/result.js");
const { buildFingerprint, normalizeRepoPath } = require("./fingerprint.js");

/** Mapa de severidad del scanner móvil (mayúsculas) al enum del core. */
const SEVERITY_MAP = Object.freeze({
  CRITICAL: result.SEVERITY.CRITICAL,
  HIGH: result.SEVERITY.HIGH,
  MEDIUM: result.SEVERITY.MEDIUM,
  LOW: result.SEVERITY.LOW,
  INFO: result.SEVERITY.INFO,
});

/** Control ids del core para cada capa móvil conservada en Flutter. */
const MOBILE_CONTROL_IDS = Object.freeze({
  M2: "mobile.flutter.dependencies",
  M5: "mobile.flutter.network",
  M9: "mobile.flutter.storage",
});

function mapSeverity(raw) {
  const key = String(raw || "").toUpperCase();
  return SEVERITY_MAP[key] || result.SEVERITY.MEDIUM;
}

/**
 * Normaliza la ruta reportada por un scanner móvil a ruta relativa del repo.
 * Si la ruta escapa del repo o es un marcador genérico (p. ej. "pubspec.yaml"
 * sin raíz), devuelve algo seguro: nunca una ruta cruda fuera de árbol.
 */
function safeRelPath(repoRoot, file) {
  if (typeof file !== "string" || file.trim() === "") return "unknown";
  try {
    return normalizeRepoPath(repoRoot, file);
  } catch (_) {
    // Rutas relativas simples (sin absoluta) que no escapan: conservarlas tal cual.
    if (!file.includes("..") && !file.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(file)) {
      return file.split("\\").join("/");
    }
    return "redacted-path";
  }
}

/**
 * Convierte un hallazgo crudo de un scanner móvil en un `Finding` del core.
 *
 * Importante: el scanner móvil incluye campos `code`/`pattern` con la línea
 * fuente. NO se copian al Finding — el contrato del core los prohíbe. Sólo se
 * usan para derivar el fingerprint (hash, no valor en claro).
 */
function toMobileFinding(repoRoot, control, raw) {
  const relPath = safeRelPath(repoRoot, raw.file || raw.File);
  const lineRaw = raw.line !== undefined ? raw.line : raw.Line;
  const lineNumber = Number.isInteger(lineRaw) && lineRaw >= 1 ? lineRaw : undefined;
  const issue = typeof raw.issue === "string" && raw.issue.trim() ? raw.issue.trim() : "mobile-finding";
  const ruleId = `${control}:${issue}`;

  // El `code`/`pattern` puede traer la línea fuente/URL/credencial. Se usa SÓLO
  // para el hash del fingerprint y jamás se persiste en claro.
  const codeHint = typeof raw.code === "string" ? raw.code : typeof raw.pattern === "string" ? raw.pattern : undefined;

  const fingerprint = buildFingerprint({
    path: relPath,
    ruleId,
    lineNumber,
    ...(codeHint ? { secret: codeHint } : {}),
  });

  const findingInput = {
    ruleId,
    path: relPath,
    severity: mapSeverity(raw.severity),
    fingerprint,
  };
  if (lineNumber !== undefined) findingInput.lineNumber = lineNumber;
  if (typeof raw.recommendation === "string" && raw.recommendation.trim()) {
    findingInput.remediation = raw.recommendation.trim();
  }
  return result.createFinding(findingInput);
}

/**
 * Adapta la salida JSON de un scanner móvil a un `PolicyResult` del core.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot          Raíz del repo (para rutas relativas).
 * @param {("M2"|"M5"|"M9")} opts.control  Capa móvil.
 * @param {boolean} opts.isFlutter        ¿El proyecto es Flutter?
 * @param {object} [opts.report]          JSON del scanner ({ findings: [...] }).
 * @param {string} [opts.mode]            "warning" | "enforce".
 * @param {string} [opts.scope]
 * @returns {{ result: object, evidence: object }}
 */
function adaptMobileReport(opts) {
  if (!opts || typeof opts !== "object") throw new TypeError("adaptMobileReport requiere opciones");
  const control = opts.control;
  const controlId = MOBILE_CONTROL_IDS[control];
  if (!controlId) throw new TypeError(`control móvil desconocido: ${JSON.stringify(control)}`);

  const mode = opts.mode === "enforce" ? "enforce" : "warning";
  const evidenceBase = {
    control: controlId,
    scope: opts.scope || "flutter-mobile",
  };

  // 12.5 — fuera de Flutter el control es NO APLICABLE, no "fallido".
  if (!opts.isFlutter) {
    return {
      result: result.createResult({
        controlId,
        decision: result.DECISION.ALLOW,
        toolStatus: result.TOOL_STATUS.NOT_APPLICABLE,
        reason: "control móvil OWASP no aplicable: el proyecto no es Flutter",
        scope: evidenceBase.scope,
      }),
      evidence: { ...evidenceBase, applicable: false, decision: "allow" },
    };
  }

  const report = opts.report;
  const rawFindings = report && Array.isArray(report.findings) ? report.findings : [];
  const findings = rawFindings.map((r) => toMobileFinding(opts.repoRoot, control, r));

  if (findings.length === 0) {
    return {
      result: result.createResult({
        controlId,
        decision: result.DECISION.ALLOW,
        toolStatus: result.TOOL_STATUS.OK,
        scope: evidenceBase.scope,
      }),
      evidence: { ...evidenceBase, applicable: true, findings: 0, decision: "allow" },
    };
  }

  // Bloqueante sólo si hay severidad alta/crítica; el resto queda como warn.
  const highest = result.maxSeverity(findings.map((f) => f.severity));
  const isBlocking = result.compareSeverity(highest, result.SEVERITY.HIGH) >= 0;
  const decision =
    isBlocking && mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;

  return {
    result: result.createResult({
      controlId,
      decision,
      toolStatus: result.TOOL_STATUS.OK,
      findings,
      reason: `control móvil OWASP (${control}) detectó ${findings.length} hallazgo(s)`,
      scope: evidenceBase.scope,
    }),
    evidence: { ...evidenceBase, applicable: true, findings: findings.length, decision },
  };
}

module.exports = {
  MOBILE_CONTROL_IDS,
  SEVERITY_MAP,
  adaptMobileReport,
  toMobileFinding,
  safeRelPath,
};
