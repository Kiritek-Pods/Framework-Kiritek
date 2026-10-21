"use strict";

/**
 * Enlace de superficies engineering (T14): `kiro`, `claude`, `git`, `ci`.
 * Separado de los adaptadores de core/security: nombres de archivo, marcador
 * y comando propios; nunca modifica entradas ni archivos de security o del
 * usuario. Idempotente (re-enlazar no duplica) y reversible.
 */

const fs = require("node:fs");
const path = require("node:path");
const git = require("./git.js");

const TEMPLATES = path.join(__dirname, "..", "..", "..", "..", "templates", "engineering", "guardrails");
const SURFACES = Object.freeze(["kiro", "claude", "git", "ci"]);
const KIRO_SHIM = ".kiritek/adapters/engineering/kiro-pretooluse.sh";
const KIRO_HOOK = ".kiro/hooks/kiritek-engineering-write.json";
const CLAUDE_SHIM = ".kiritek/adapters/engineering/claude-pretooluse.sh";
const CLAUDE_SETTINGS = ".claude/settings.json";
const CLAUDE_CMD_RE = /\.kiritek\/adapters\/engineering\/claude-pretooluse\.sh/;
const CI_WORKFLOW = ".github/workflows/kiritek-engineering.yml";
const CI_MARKER = "Kiritek engineering/guardrails";

const tpl = (rel) => fs.readFileSync(path.join(TEMPLATES, rel), "utf8");

function write(repoRoot, rel, content, mode) {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.kiritek-tmp`;
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, abs);
  if (mode) fs.chmodSync(abs, mode);
}

const read = (repoRoot, rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (_) {
    return null;
  }
};

function isEngineeringClaudeEntry(entry) {
  return !!entry && Array.isArray(entry.hooks) && entry.hooks.some((h) => h && CLAUDE_CMD_RE.test(String(h.command || "")));
}

function linkClaude(repoRoot) {
  const current = read(repoRoot, CLAUDE_SETTINGS);
  let settings = {};
  if (current !== null) {
    try {
      settings = JSON.parse(current);
    } catch (_) {
      return { surface: "claude", status: "manual", reason: ".claude/settings.json ilegible: no se modifica" };
    }
  }
  const ours = JSON.parse(tpl("adapters/claude/settings.hooks.json")).hooks.PreToolUse;
  settings.hooks = settings.hooks || {};
  const existing = (settings.hooks.PreToolUse || []).filter((e) => !isEngineeringClaudeEntry(e));
  settings.hooks.PreToolUse = [...existing, ...ours];
  const next = `${JSON.stringify(settings, null, 2)}\n`;
  write(repoRoot, CLAUDE_SHIM, tpl("adapters/claude/pretooluse.sh"), 0o755);
  if (next !== current) write(repoRoot, CLAUDE_SETTINGS, next);
  return { surface: "claude", status: next === current ? "noop" : "linked" };
}

function unlinkClaude(repoRoot) {
  const current = read(repoRoot, CLAUDE_SETTINGS);
  if (current !== null) {
    try {
      const settings = JSON.parse(current);
      if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((e) => !isEngineeringClaudeEntry(e));
        if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
        if (!Object.keys(settings.hooks).length) delete settings.hooks;
        write(repoRoot, CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
      }
    } catch (_) {
      /* ilegible: no se toca */
    }
  }
  fs.rmSync(path.join(repoRoot, CLAUDE_SHIM), { force: true });
}

function linkKiro(repoRoot) {
  const hook = tpl("adapters/kiro/kiritek-engineering-write.kiro.hook.json");
  const status = read(repoRoot, KIRO_HOOK) === hook ? "noop" : "linked";
  write(repoRoot, KIRO_SHIM, tpl("adapters/kiro/pretooluse.sh"), 0o755);
  write(repoRoot, KIRO_HOOK, hook);
  return { surface: "kiro", status };
}

function linkCi(repoRoot) {
  const content = tpl("ci/github/kiritek-engineering.yml");
  const current = read(repoRoot, CI_WORKFLOW);
  if (current === content) return { surface: "ci", status: "noop" };
  if (current !== null && !current.includes(CI_MARKER)) {
    write(repoRoot, `${CI_WORKFLOW}.kiritek-new`, content);
    return { surface: "ci", status: "proposal", reason: "workflow existente del usuario: propuesta .kiritek-new" };
  }
  write(repoRoot, CI_WORKFLOW, content);
  return { surface: "ci", status: "linked" };
}

/**
 * @param {string} repoRoot
 * @param {string[]} surfaces  subconjunto de SURFACES
 */
function linkSurfaces(repoRoot, surfaces, { dryRun = false } = {}) {
  const unknown = surfaces.filter((s) => !SURFACES.includes(s));
  if (unknown.length) throw Object.assign(new Error(`superficie desconocida: ${unknown.join(", ")}`), { code: "CLI_USAGE" });
  // Shims y hooks son POSIX sh: en plataformas sin soporte no se instalan.
  const posixOnly = ["kiro", "claude", "git"];
  const unsupported = (s) => process.platform === "win32" && posixOnly.includes(s);
  if (dryRun) return surfaces.map((s) => (unsupported(s) ? { surface: s, status: "unsupported" } : { surface: s, status: "planned", ...(s === "git" ? { plan: git.planGitIntegration(repoRoot) } : {}) }));
  return surfaces.map((s) => {
    if (unsupported(s)) return { surface: s, status: "unsupported", reason: `${s} requiere sh POSIX; use CI en ${process.platform}` };
    if (s === "kiro") return linkKiro(repoRoot);
    if (s === "claude") return linkClaude(repoRoot);
    if (s === "ci") return linkCi(repoRoot);
    const r = git.installGitIntegration(repoRoot);
    return { surface: "git", status: r.strategy === "manual" ? "manual" : r.strategy === "noop" ? "noop" : "linked", ...(r.reason ? { reason: r.reason, snippet: r.snippet } : {}) };
  });
}

/** Quita sólo lo engineering de cada superficie. */
function unlinkSurfaces(repoRoot) {
  unlinkClaude(repoRoot);
  for (const rel of [KIRO_SHIM, KIRO_HOOK]) fs.rmSync(path.join(repoRoot, rel), { force: true });
  const ci = read(repoRoot, CI_WORKFLOW);
  if (ci !== null && ci.includes(CI_MARKER)) fs.rmSync(path.join(repoRoot, CI_WORKFLOW), { force: true });
  git.uninstallGitIntegration(repoRoot);
}

module.exports = { SURFACES, KIRO_SHIM, KIRO_HOOK, CLAUDE_SHIM, CLAUDE_SETTINGS, CI_WORKFLOW, linkSurfaces, unlinkSurfaces, isEngineeringClaudeEntry };
