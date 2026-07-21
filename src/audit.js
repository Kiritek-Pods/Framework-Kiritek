"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/;

/**
 * % de los últimos `sampleSize` commits que siguen Conventional Commits.
 * Proxy de "el equipo usa git-workflow de verdad", no solo "está instalado".
 * @returns {{sampleSize: number, conventionalCommitRate: number|null}}
 */
function conventionalCommitRate(destDir, sampleSize = 200) {
  let log;
  try {
    log = execSync(`git log -n ${sampleSize} --pretty=%s`, { cwd: destDir, encoding: "utf8" });
  } catch {
    return { sampleSize: 0, conventionalCommitRate: null };
  }
  const subjects = log.split("\n").filter(Boolean);
  if (subjects.length === 0) return { sampleSize: 0, conventionalCommitRate: null };
  const matching = subjects.filter((s) => CONVENTIONAL_COMMIT_RE.test(s)).length;
  return { sampleSize: subjects.length, conventionalCommitRate: matching / subjects.length };
}

function repoIdentifier(destDir) {
  try {
    const remote = execSync("git config --get remote.origin.url", { cwd: destDir, encoding: "utf8" }).trim();
    return remote.replace(/^git@github\.com:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  } catch {
    return path.basename(destDir);
  }
}

function loadAuditConfig(destDir) {
  const configPath = path.join(destDir, "kiritek-audit.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "kiritek-audit.config.json no existe — corre `npx kiritek-init` primero para instalar el core."
    );
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/**
 * Chequea que cada `check.path` (relativo a destDir) exista.
 * @returns {{ok: boolean, results: Array<{name: string, path: string, pass: boolean}>}}
 */
function runAudit(destDir) {
  const config = loadAuditConfig(destDir);
  const results = config.checks.map((check) => ({
    name: check.name,
    path: check.path,
    pass: fs.existsSync(path.join(destDir, check.path)),
  }));
  return { ok: results.every((r) => r.pass), results };
}

function appendComplianceLog(destDir, auditResult) {
  const logPath = path.join(destDir, "kiritek-compliance.md");
  const timestamp = new Date().toISOString();
  const lines = [
    `## Auditoría ${timestamp}`,
    "",
    `Estado: ${auditResult.ok ? "✅ cumple" : "❌ incompleto"}`,
    "",
    ...auditResult.results.map((r) => `- ${r.pass ? "✅" : "❌"} ${r.name} (\`${r.path}\`)`),
    "",
    "---",
    "",
  ];
  fs.appendFileSync(logPath, lines.join("\n"));
  return logPath;
}

/**
 * Manda el resultado de la auditoría a un webhook (Google Sheet / Slack / lo que sea
 * que reciba POST JSON). No lanza si falla — el reporte remoto es best-effort,
 * nunca debe romper el `audit` local.
 */
async function sendMetricsReport(webhookUrl, destDir, auditResult) {
  const { conventionalCommitRate: rate, sampleSize } = conventionalCommitRate(destDir);
  const payload = {
    repo: repoIdentifier(destDir),
    timestamp: new Date().toISOString(),
    compliant: auditResult.ok,
    checks: auditResult.results,
    conventionalCommitRate: rate,
    conventionalCommitSampleSize: sampleSize,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, payload, error: err.message };
  }
}

module.exports = {
  loadAuditConfig,
  runAudit,
  appendComplianceLog,
  conventionalCommitRate,
  sendMetricsReport,
};
