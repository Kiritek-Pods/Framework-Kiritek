"use strict";

const fs = require("fs");
const path = require("path");

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

module.exports = { loadAuditConfig, runAudit, appendComplianceLog };
