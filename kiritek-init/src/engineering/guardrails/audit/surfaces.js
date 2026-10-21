"use strict";

/**
 * Observación local de superficies (T15.1, T15.6, R19.4–R19.5). Verifica
 * conexión real, no presencia: un archivo presente pero desconectado,
 * alterado o no ejecutable no cuenta como cobertura. CI y release remotos no
 * se pueden observar localmente: su estado máximo es `unknown`.
 *
 * Estados: verified | missing | disconnected | drift | not-executable | unknown.
 */

const fs = require("node:fs");
const path = require("node:path");
const git = require("../adapters/git.js");
const inst = require("../adapters/install.js");
const { platformCapabilities } = require("../compatibility.js");

const TEMPLATES = path.join(__dirname, "..", "..", "..", "..", "templates", "engineering", "guardrails");
const tpl = (rel) => fs.readFileSync(path.join(TEMPLATES, rel), "utf8");

function fileState(repoRoot, rel, expected, { executable = false } = {}) {
  const abs = path.join(repoRoot, rel);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (_) {
    return "missing";
  }
  if (!st.isFile()) return "drift";
  if (expected !== undefined && fs.readFileSync(abs, "utf8") !== expected) return "drift";
  if (executable && (st.mode & 0o111) === 0) return "not-executable";
  return "ok";
}

const surface = (status, reason, extra = {}) => ({ status, ...(reason ? { reason } : {}), ...extra });

function observeKiro(repoRoot) {
  const shim = fileState(repoRoot, inst.KIRO_SHIM, tpl("adapters/kiro/pretooluse.sh"), { executable: true });
  const hook = fileState(repoRoot, inst.KIRO_HOOK);
  if (shim === "missing" && hook === "missing") return surface("missing", "adaptador Kiro no enlazado");
  if (hook === "missing") return surface("disconnected", "shim presente sin hook .kiro/hooks que lo invoque");
  if (shim === "missing") return surface("disconnected", "hook Kiro apunta a un shim inexistente");
  let wired = false;
  try {
    wired = JSON.parse(fs.readFileSync(path.join(repoRoot, inst.KIRO_HOOK), "utf8")).hooks.some((h) => h.trigger === "PreToolUse" && String(h.action && h.action.command).includes("kiro-pretooluse.sh"));
  } catch (_) {
    return surface("drift", "hook Kiro ilegible");
  }
  if (!wired) return surface("disconnected", "el hook Kiro no invoca el shim engineering");
  if (shim !== "ok") return surface(shim, shim === "drift" ? "shim Kiro alterado respecto de la plantilla" : "shim Kiro sin permiso de ejecución");
  return surface("verified");
}

function observeClaude(repoRoot) {
  const shim = fileState(repoRoot, inst.CLAUDE_SHIM, tpl("adapters/claude/pretooluse.sh"), { executable: true });
  let entry = false;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, inst.CLAUDE_SETTINGS), "utf8"));
    entry = ((settings.hooks && settings.hooks.PreToolUse) || []).some(inst.isEngineeringClaudeEntry);
  } catch (_) {
    entry = false;
  }
  if (shim === "missing" && !entry) return surface("missing", "adaptador Claude no enlazado");
  if (!entry) return surface("disconnected", "shim presente sin entrada en .claude/settings.json");
  if (shim === "missing") return surface("disconnected", ".claude/settings.json apunta a un shim inexistente");
  if (shim !== "ok") return surface(shim, shim === "drift" ? "shim Claude alterado respecto de la plantilla" : "shim Claude sin permiso de ejecución");
  return surface("verified");
}

function observeGit(repoRoot) {
  const script = fileState(repoRoot, git.HOOK_SCRIPT, tpl("hooks/pre-commit"), { executable: true });
  const v = git.verifyGitIntegration(repoRoot);
  const hookFile = path.join(git.hooksDir(repoRoot).dir, "pre-commit");
  if (script === "missing" && !v.wired) return surface("missing", "gate pre-commit no instalado");
  if (script === "missing") return surface("disconnected", "el hook invoca un script engineering inexistente");
  if (!v.wired) return surface("disconnected", "script presente pero ningún hook pre-commit lo invoca", { snippet: git.INVOCATION });
  if (script !== "ok") return surface(script, script === "drift" ? "script pre-commit alterado respecto de la plantilla" : "script pre-commit sin permiso de ejecución");
  try {
    const st = fs.statSync(hookFile);
    const content = fs.readFileSync(hookFile, "utf8");
    if ((st.mode & 0o111) === 0) return surface("not-executable", ".git/hooks/pre-commit sin permiso de ejecución");
    if (content.includes(git.MARKER) && content !== git.dispatcher()) return surface("drift", "dispatcher pre-commit alterado");
  } catch (_) {
    /* integración vía gestor de terceros: verificada por la línea de invocación */
  }
  return surface("verified");
}

/** CI/release remotos: nunca `verified` por presencia local (R19.5). */
function observeCi(repoRoot) {
  const state = fileState(repoRoot, inst.CI_WORKFLOW, tpl("ci/github/kiritek-engineering.yml"));
  if (state === "missing") return surface("missing", "workflow de CI engineering ausente", { observation: "not-configured" });
  if (state === "drift") return surface("drift", "workflow alterado respecto de la plantilla", { observation: "unknown" });
  return surface("unknown", "workflow presente; la ejecución remota no es observable localmente", { observation: "unknown" });
}

function observeSurfaces(repoRoot, { platform } = {}) {
  const caps = platformCapabilities({ platform });
  const unsupported = (what) => surface("unknown", `${what} no soportado en ${caps.platform} (shims POSIX); cobertura en CI`, { observation: "not-applicable" });
  return {
    kiro: caps.agentShims ? observeKiro(repoRoot) : unsupported("adaptador Kiro"),
    claude: caps.agentShims ? observeClaude(repoRoot) : unsupported("adaptador Claude"),
    "git-pre-commit": caps.gitHooks ? observeGit(repoRoot) : unsupported("hook pre-commit"),
    ci: observeCi(repoRoot),
    release: surface("unknown", "pipeline de release no observable localmente", { observation: "unknown" }),
  };
}

/** Estado de cobertura del MOMENTO según sus superficies locales. */
function momentSurfaceStatus(moment, surfaces) {
  const notApplicable = (s) => s.observation === "not-applicable";
  if (moment === "agent") {
    const s = [surfaces.kiro, surfaces.claude];
    if (s.every(notApplicable)) return { status: "unavailable", reason: s[0].reason };
    if (s.some((x) => x.status === "verified")) return { status: "verified" };
    const bad = s.find((x) => ["drift", "not-executable", "disconnected"].includes(x.status));
    return bad ? { status: bad.status === "drift" ? "drift" : "unavailable", reason: bad.reason } : { status: "unavailable", reason: "ninguna superficie de agente enlazada" };
  }
  if (moment === "pre-commit") {
    const g = surfaces["git-pre-commit"];
    if (g.status === "verified") return { status: "verified" };
    if (notApplicable(g)) return { status: "unavailable", reason: g.reason };
    return { status: g.status === "drift" ? "drift" : "unavailable", reason: g.reason };
  }
  const s = moment === "pr" ? surfaces.ci : surfaces.release;
  return { status: s.status === "drift" ? "drift" : "unknown", reason: s.reason };
}

module.exports = { observeSurfaces, momentSurfaceStatus };
