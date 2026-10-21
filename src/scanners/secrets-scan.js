"use strict";

/**
 * Escaneo de secretos con Gitleaks: une el manifiesto pinneado, la descarga
 * verificada (tool-download), el runner (gitleaks-runner) y las excepciones
 * gobernadas. Es la pieza que `scan` y `security install` invocan.
 *
 * Garantías:
 *  - Sólo se ejecuta el binario cuyo archivo verificó contra el SHA-256 del
 *    manifiesto (resolvePackagedTool). Nunca un `gitleaks` del PATH.
 *  - Herramienta ausente/corrupta/offline → `unavailable`, nunca "limpio":
 *    en `warning` advierte, en `enforce` bloquea (fail-closed).
 *  - Bypasses no gobernados desactivados: comentarios `gitleaks:allow` y
 *    `.gitleaksignore` del repo se ignoran; sólo cuentan las excepciones de
 *    `.kiritek/exceptions.json` válidas bajo gobernanza.
 *  - El reporte se escribe en un temporal con `--redact` y se borra al
 *    terminar; del hallazgo sólo se conservan metadatos (gitleaks-runner).
 *
 * Variables de proceso (operativas, no de política):
 *  - KIRITEK_TOOL_CACHE: raíz de la cache de binarios (default ~/.cache/kiritek/tools).
 *  - KIRITEK_OFFLINE=1:  nunca descargar; sólo cache.
 *
 * (Requisitos 2.*, 3.6, 24.*, 28.*, G.3, G.12.)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const result = require("../domain/result.js");
const exceptionDomain = require("../domain/exception.js");
const exceptionsPolicy = require("../policy/exceptions.js");
const { resolvePackagedTool, STATUS } = require("./tool-download.js");
const { runGitleaks, CONTROL_ID } = require("./gitleaks-runner.js");

const TOOL_NAME = "gitleaks";
const PACKAGE_MANIFEST = path.join(__dirname, "..", "..", "templates", "core", "security", "tools", "manifest.json");
const PACKAGE_CONFIG = path.join(__dirname, "..", "..", "templates", "core", "security", "gitleaks", "gitleaks.toml");
const DOWNLOAD_TIMEOUT_MS = 120000;

/** Manifiesto: el instalado en el repo manda; si no, el del paquete. */
function loadManifest(repoRoot) {
  const local = path.join(repoRoot, ".kiritek", "tools", "manifest.json");
  const file = fs.existsSync(local) ? local : PACKAGE_MANIFEST;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function configPathFor(repoRoot) {
  const local = path.join(repoRoot, ".kiritek", "gitleaks.toml");
  return fs.existsSync(local) ? local : PACKAGE_CONFIG;
}

/**
 * Descarga síncrona: delega `httpsDownload` (async) a un proceso hijo de Node
 * para que el resolvedor siga siendo síncrono, sin depender de curl.
 */
function syncDownloader(url, destPath) {
  const script =
    "require(process.argv[3]).httpsDownload(process.argv[1], process.argv[2])" +
    ".then(() => process.exit(0), (e) => { process.stderr.write(String(e && e.message)); process.exit(1); })";
  const res = spawnSync(process.execPath, ["-e", script, url, destPath, require.resolve("./tool-download.js")], {
    encoding: "utf8",
    timeout: DOWNLOAD_TIMEOUT_MS,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error((res.stderr || "").trim() || `descarga terminó con estado ${res.status}`);
}

/**
 * Resuelve el binario verificado de Gitleaks (cache o descarga).
 *
 * @param {object} opts { repoRoot, offline, cacheRoot, downloader, platform, arch }
 * @returns {{ status, binaryPath?, version?, reason? }}
 */
function ensureGitleaks(opts) {
  let manifest;
  try {
    manifest = loadManifest(opts.repoRoot);
  } catch (err) {
    return { status: STATUS.INTEGRITY_FAILED, reason: `manifiesto de herramientas ilegible: ${err.message}` };
  }
  return resolvePackagedTool({
    manifest,
    toolName: TOOL_NAME,
    platform: opts.platform || process.platform,
    arch: opts.arch || process.arch,
    cacheRoot: opts.cacheRoot || process.env.KIRITEK_TOOL_CACHE || undefined,
    offline: !!opts.offline || process.env.KIRITEK_OFFLINE === "1",
    downloader: opts.downloader || syncDownloader,
  });
}

/**
 * Argumentos de Gitleaks 8.18.x por alcance (sin shell).
 *  - staged:     `protect --staged`
 *  - push:       `detect --log-opts=--no-walk <commits>` (exactamente esos)
 *  - repository: `detect --no-git` (árbol de trabajo actual)
 *  - history:    `detect` (todo el historial; `historyDepth` numérico lo acota)
 */
function buildArgs(scope, { repoRoot, configPath, reportPath, commits, historyDepth }) {
  const common = [
    "--source", repoRoot,
    "--config", configPath,
    "--report-format", "json",
    "--report-path", reportPath,
    "--redact",
    "--no-banner",
    "--exit-code", "1",
    "--log-level", "error",
    // Bypasses no gobernados: se ignoran (sólo valen excepciones Kiritek).
    "--ignore-gitleaks-allow",
    "--gitleaks-ignore-path", path.join(repoRoot, ".kiritek"),
  ];
  if (scope === "staged") return ["protect", "--staged", ...common];
  if (scope === "push") return ["detect", ...common, `--log-opts=--no-walk ${commits.join(" ")}`];
  if (scope === "repository") return ["detect", "--no-git", ...common];
  const depth = Number(historyDepth);
  if (Number.isInteger(depth) && depth > 0) return ["detect", ...common, `--log-opts=--max-count=${depth}`];
  return ["detect", ...common];
}

/**
 * Excepciones gobernadas de `.kiritek/exceptions.json`: sólo las válidas bajo
 * gobernanza (owner, aprobador, expiración, alcance acotado). Un archivo
 * ausente es "sin excepciones"; uno inválido no aporta ninguna (fail-closed).
 */
function loadGovernedExceptions(repoRoot, mode) {
  const file = path.join(repoRoot, ".kiritek", "exceptions.json");
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  return list.filter((exc) => exceptionsPolicy.validateException(exc, { mode }).valid);
}

/** Resultado honesto cuando la herramienta no está disponible. */
function unavailableResult(tool, mode, scope) {
  const toolStatus =
    tool.status === STATUS.INTEGRITY_FAILED
      ? result.TOOL_STATUS.INTEGRITY_FAILED
      : tool.status === STATUS.INCOMPATIBLE
      ? result.TOOL_STATUS.INCOMPATIBLE
      : result.TOOL_STATUS.UNAVAILABLE;
  return result.createResult({
    controlId: CONTROL_ID,
    decision: mode === "enforce" ? result.DECISION.ERROR : result.DECISION.WARN,
    toolStatus,
    reason: `gitleaks no disponible (${tool.reason || tool.status}); no se declara limpio sin ejecutar`,
    remediation: "Ejecuta `kiritek-init security install` con red para descargar el binario verificado.",
    scope,
  });
}

/** Quita los hallazgos cubiertos por excepciones vigentes de este control. */
function applyExceptions(res, exceptions, mode, now) {
  if (!res.findings || res.findings.length === 0) return res;
  const relevant = exceptions.filter((e) => e.controlId === CONTROL_ID);
  const remaining = res.findings.filter(
    (f) => !relevant.some((exc) => exceptionDomain.covers(exc, f, now ? { now } : {}))
  );
  if (remaining.length === res.findings.length) return res;
  if (remaining.length === 0) {
    return result.createResult({ controlId: CONTROL_ID, decision: result.DECISION.ALLOW, toolStatus: res.toolStatus, scope: res.scope });
  }
  return result.createResult({
    controlId: CONTROL_ID,
    decision: mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN,
    toolStatus: res.toolStatus,
    findings: remaining,
    reason: res.reason,
    remediation: res.remediation,
    scope: res.scope,
  });
}

/**
 * Ejecuta Gitleaks sobre un alcance.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {"staged"|"push"|"repository"|"history"} opts.scope
 * @param {string} opts.mode
 * @param {string[]} [opts.commits]      Requerido para scope "push".
 * @param {string|number} [opts.historyDepth]
 * @param {boolean} [opts.offline]
 * @param {object} [opts.deps]           { exec, downloader, cacheRoot, now, tool }
 * @returns {{ result, evidence: object|null, tool: object }}
 */
function scanSecrets(opts) {
  const { repoRoot, scope, mode } = opts;
  const deps = opts.deps || {};

  if (scope === "push" && (!opts.commits || opts.commits.length === 0)) {
    return {
      result: result.createResult({ controlId: CONTROL_ID, decision: result.DECISION.ALLOW, toolStatus: result.TOOL_STATUS.NOT_APPLICABLE, scope }),
      evidence: null,
      tool: { status: "not-needed" },
    };
  }

  const tool =
    deps.tool ||
    ensureGitleaks({ repoRoot, offline: opts.offline, cacheRoot: deps.cacheRoot, downloader: deps.downloader });
  if (tool.status !== STATUS.OK) {
    return { result: unavailableResult(tool, mode, scope), evidence: null, tool };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gitleaks-"));
  const reportPath = path.join(tmpDir, "report.json");
  const configPath = configPathFor(repoRoot);
  try {
    const run = runGitleaks({
      repoRoot,
      binaryPath: tool.binaryPath,
      version: tool.version,
      configPath,
      reportPath,
      mode,
      scope,
      exec: deps.exec,
      args: buildArgs(scope, { repoRoot, configPath, reportPath, commits: opts.commits, historyDepth: opts.historyDepth }),
    });
    const exceptions = loadGovernedExceptions(repoRoot, mode);
    return { result: applyExceptions(run.result, exceptions, mode, deps.now), evidence: run.evidence, tool };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// deny (hallazgo concreto) se antepone a error (herramienta caída): ambos
// bloquean, pero el hallazgo es lo accionable para quien lo lee.
const DECISION_RANK = { allow: 0, warn: 1, error: 2, deny: 3 };

/** El resultado más severo de varios controles (para decisión/exit code). */
function mostSevere(results) {
  return results.reduce((a, b) => (DECISION_RANK[b.decision] > DECISION_RANK[a.decision] ? b : a));
}

module.exports = {
  CONTROL_ID,
  TOOL_NAME,
  ensureGitleaks,
  buildArgs,
  scanSecrets,
  loadGovernedExceptions,
  mostSevere,
  syncDownloader,
};
