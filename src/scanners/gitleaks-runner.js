"use strict";

/**
 * Runner de Gitleaks.
 *
 * Ejecuta Gitleaks sobre un objetivo (directorio, staged, rango) y traduce su
 * salida a un `PolicyResult` del core. Garantías:
 *  - Se invoca con `spawn` y argumentos separados (sin shell).
 *  - Del reporte de Gitleaks se conservan SÓLO metadatos: regla, ruta relativa,
 *    número de línea y un fingerprint estable. Nunca el secreto, el match ni la
 *    línea fuente.
 *  - La evidencia incluye la versión efectiva y el hash de la configuración.
 *  - Un fallo de herramienta se reporta como `error`/`unavailable`, nunca como
 *    "sin hallazgos".
 *
 * El `exec` (ejecución del binario) se inyecta para pruebas sin binario real.
 *
 * (Requisitos 2.4, 2.7, 3.6, 11.3, 13.3, 24.*, G.3, G.12.)
 */

const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const result = require("../domain/result.js");
const { buildFingerprint, normalizeRepoPath } = require("./fingerprint.js");

const CONTROL_ID = "secrets.gitleaks";

function configHash(configPath) {
  try {
    return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(configPath)).digest("hex").slice(0, 32);
  } catch (_) {
    return "sha256:none";
  }
}

/** Ejecutor por defecto: spawn del binario con args separados. */
function defaultExec(binaryPath, args) {
  const res = spawnSync(binaryPath, args, { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "", error: res.error };
}

/**
 * Mapea un hallazgo crudo de Gitleaks (objeto del reporte JSON) a un Finding
 * redactado. Nunca copia Secret/Match/línea fuente.
 */
function toRedactedFinding(repoRoot, raw) {
  const relPath = safeRel(repoRoot, raw.File || raw.file || "unknown");
  const ruleId = raw.RuleID || raw.rule || "gitleaks";
  const lineNumber = Number(raw.StartLine || raw.startLine) || undefined;
  const fingerprint =
    raw.Fingerprint || buildFingerprint({ path: relPath, ruleId, lineNumber });
  return result.createFinding({
    ruleId,
    path: relPath,
    severity: result.SEVERITY.CRITICAL,
    fingerprint,
    lineNumber,
    remediation: "Revoca y rota la credencial; elimínala del archivo y del historial si fue publicada.",
  });
}

function safeRel(repoRoot, file) {
  try {
    return normalizeRepoPath(repoRoot, file);
  } catch (_) {
    // Si Gitleaks reporta una ruta rara, no la propagamos cruda.
    return "redacted-path";
  }
}

/**
 * Ejecuta Gitleaks y devuelve { result, evidence }.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.binaryPath
 * @param {string} opts.version
 * @param {string} opts.configPath
 * @param {string} opts.mode          "warning" | "enforce"
 * @param {string[]} opts.args        Args ya construidos (sin shell).
 * @param {(bin, args) => object} [opts.exec]
 * @returns {{ result: object, evidence: object }}
 */
function runGitleaks(opts) {
  const exec = opts.exec || defaultExec;
  const mode = opts.mode === "enforce" ? "enforce" : "warning";
  const cfgHash = configHash(opts.configPath);

  const run = exec(opts.binaryPath, opts.args);

  const evidenceBase = {
    control: CONTROL_ID,
    command: `${basename(opts.binaryPath)} ${opts.args.join(" ")}`,
    toolVersion: opts.version || "unknown",
    configHash: cfgHash,
    scope: opts.scope || "unknown",
  };

  // Error de ejecución (binario ausente, crash): no es "limpio".
  if (run.error || typeof run.status !== "number") {
    return {
      result: result.createResult({
        controlId: CONTROL_ID,
        decision: result.DECISION.ERROR,
        toolStatus: result.TOOL_STATUS.UNAVAILABLE,
        reason: `gitleaks no se pudo ejecutar: ${run.error ? run.error.message : "sin status"}`,
      }),
      evidence: { ...evidenceBase, exitCode: -1, decision: "error" },
    };
  }

  // Gitleaks: exit 0 = limpio; exit 1 = hallazgos; otros = error de herramienta.
  if (run.status === 0) {
    return {
      result: result.createResult({
        controlId: CONTROL_ID,
        decision: result.DECISION.ALLOW,
        toolStatus: result.TOOL_STATUS.OK,
        scope: opts.scope,
      }),
      evidence: { ...evidenceBase, exitCode: 0, decision: "allow" },
    };
  }

  if (run.status !== 1) {
    return {
      result: result.createResult({
        controlId: CONTROL_ID,
        decision: result.DECISION.ERROR,
        toolStatus: result.TOOL_STATUS.UNAVAILABLE,
        reason: `gitleaks terminó con estado inesperado ${run.status}`,
      }),
      evidence: { ...evidenceBase, exitCode: run.status, decision: "error" },
    };
  }

  // status === 1: hay hallazgos. Parsear el reporte JSON de forma defensiva.
  let raw = [];
  try {
    raw = parseReport(opts.reportPath, run.stdout);
  } catch (_) {
    raw = [];
  }

  const findings = raw.map((r) => toRedactedFinding(opts.repoRoot, r));
  const decision = mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;

  return {
    result: result.createResult({
      controlId: CONTROL_ID,
      decision,
      toolStatus: result.TOOL_STATUS.OK,
      findings: findings.length ? findings : undefined,
      reason: "gitleaks detectó posibles secretos",
      remediation: "Revoca/rota las credenciales detectadas y elimínalas del cambio.",
      scope: opts.scope,
    }),
    evidence: { ...evidenceBase, exitCode: 1, decision },
  };
}

function parseReport(reportPath, stdout) {
  let text = "";
  if (reportPath && fs.existsSync(reportPath)) {
    text = fs.readFileSync(reportPath, "utf8");
  } else if (stdout && stdout.trim().startsWith("[")) {
    text = stdout;
  }
  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

module.exports = {
  CONTROL_ID,
  runGitleaks,
  toRedactedFinding,
  configHash,
};
