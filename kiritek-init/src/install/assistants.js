"use strict";

/**
 * Enlace de los adaptadores de asistentes: registra los shims de Kiritek en la
 * configuración que cada asistente lee de verdad.
 *
 *  - Claude Code: añade las entradas `hooks.PreToolUse` de Kiritek a
 *    `.claude/settings.json` SIN tocar los hooks del usuario. Las entradas de
 *    Kiritek se reconocen por el comando del shim, así que re-enlazar es
 *    idempotente y desenlazar sólo quita lo nuestro.
 *  - Kiro: escribe `.kiro/hooks/kiritek-security-{command,write}.json`
 *    (formato de hooks v1 de Kiro). Al desenlazar sólo se borran si siguen
 *    siendo de Kiritek.
 *
 * Los shims bloquean TODO (fail-safe) si `kiritek-init` no está en el PATH, así
 * que el instalador sólo enlaza cuando el CLI es localizable (ver cliInPath).
 */

const fs = require("fs");
const path = require("path");

const TEMPLATES = path.join(__dirname, "..", "..", "templates", "core", "security", "adapters");
const CLAUDE_SETTINGS = path.join(".claude", "settings.json");
const CLAUDE_SHIM_RE = /\.kiritek\/adapters\/claude\/pretooluse\.sh/;
const KIRO_SHIM_RE = /\.kiritek\/adapters\/kiro\/pretooluse\.sh/;
const KIRO_FILES = Object.freeze({
  "kiritek-security-command.json": "kiritek-security-command.kiro.hook.json",
  "kiritek-security-write.json": "kiritek-security-write.kiro.hook.json",
});

/** ¿`kiritek-init` es ejecutable desde el PATH? (los shims lo invocan así) */
function cliInPath(env = process.env) {
  const names = process.platform === "win32" ? ["kiritek-init.cmd", "kiritek-init.exe", "kiritek-init"] : ["kiritek-init"];
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      try {
        fs.accessSync(path.join(dir, name), fs.constants.X_OK);
        return true;
      } catch (_) {
        /* siguiente */
      }
    }
  }
  return false;
}

/** Borra los directorios indicados (en orden) sólo si quedaron vacíos. */
function removeIfEmpty(repoRoot, rels) {
  for (const rel of rels) {
    const abs = path.join(repoRoot, rel);
    try {
      if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    } catch (_) {
      /* no existe o no está vacío */
    }
  }
}

function writeAtomic(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.kiritek-tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, abs);
}

function isKiritekClaudeEntry(entry) {
  return !!entry && Array.isArray(entry.hooks) && entry.hooks.some((h) => h && CLAUDE_SHIM_RE.test(String(h.command || "")));
}

/**
 * Enlaza el adaptador Claude en `.claude/settings.json`.
 * @returns {{ status: "linked"|"conflict", path, reason? }}
 */
function linkClaude(repoRoot, { dryRun } = {}) {
  const abs = path.join(repoRoot, CLAUDE_SETTINGS);
  let settings = {};
  if (fs.existsSync(abs)) {
    try {
      settings = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (_) {
      return { status: "conflict", path: CLAUDE_SETTINGS, reason: ".claude/settings.json no es JSON válido; no se modifica" };
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return { status: "conflict", path: CLAUDE_SETTINGS, reason: ".claude/settings.json no es un objeto; no se modifica" };
    }
  }
  const hooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  if (hooks.PreToolUse !== undefined && !Array.isArray(hooks.PreToolUse)) {
    return { status: "conflict", path: CLAUDE_SETTINGS, reason: "hooks.PreToolUse no es un arreglo; no se modifica" };
  }
  const ours = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "claude", "settings.hooks.json"), "utf8")).hooks.PreToolUse;
  const userEntries = (hooks.PreToolUse || []).filter((e) => !isKiritekClaudeEntry(e));
  settings.hooks = { ...hooks, PreToolUse: userEntries.concat(ours) };
  if (!dryRun) writeAtomic(abs, JSON.stringify(settings, null, 2) + "\n");
  return { status: "linked", path: CLAUDE_SETTINGS };
}

/** Quita sólo las entradas de Kiritek; borra el archivo si queda vacío. */
function unlinkClaude(repoRoot, { dryRun } = {}) {
  const abs = path.join(repoRoot, CLAUDE_SETTINGS);
  if (!fs.existsSync(abs)) return { status: "absent" };
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (_) {
    return { status: "conflict", reason: ".claude/settings.json no es JSON válido; no se modifica" };
  }
  const pre = settings && settings.hooks && Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : null;
  if (!pre || !pre.some(isKiritekClaudeEntry)) return { status: "absent" };
  const rest = pre.filter((e) => !isKiritekClaudeEntry(e));
  if (rest.length) settings.hooks.PreToolUse = rest;
  else delete settings.hooks.PreToolUse;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  if (!dryRun) {
    if (Object.keys(settings).length === 0) {
      fs.rmSync(abs);
      removeIfEmpty(repoRoot, [".claude"]);
    } else writeAtomic(abs, JSON.stringify(settings, null, 2) + "\n");
  }
  return { status: "unlinked", path: CLAUDE_SETTINGS };
}

/**
 * Enlaza el adaptador Kiro en `.kiro/hooks/`. Un archivo con el mismo nombre
 * que NO sea de Kiritek no se pisa.
 */
function linkKiro(repoRoot, { dryRun } = {}) {
  const written = [];
  for (const [target, template] of Object.entries(KIRO_FILES)) {
    const rel = path.join(".kiro", "hooks", target);
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs) && !KIRO_SHIM_RE.test(fs.readFileSync(abs, "utf8"))) {
      return { status: "conflict", path: rel, reason: `${rel} existe y no es de Kiritek; no se modifica` };
    }
    if (!dryRun) writeAtomic(abs, fs.readFileSync(path.join(TEMPLATES, "kiro", "hooks", template), "utf8"));
    written.push(rel);
  }
  return { status: "linked", paths: written };
}

function unlinkKiro(repoRoot, { dryRun } = {}) {
  const removed = [];
  for (const target of Object.keys(KIRO_FILES)) {
    const rel = path.join(".kiro", "hooks", target);
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !KIRO_SHIM_RE.test(fs.readFileSync(abs, "utf8"))) continue;
    if (!dryRun) fs.rmSync(abs);
    removed.push(rel);
  }
  if (!dryRun) removeIfEmpty(repoRoot, [path.join(".kiro", "hooks"), ".kiro"]);
  return { status: removed.length ? "unlinked" : "absent", paths: removed };
}

/**
 * Enlaza los asistentes pedidos.
 * @param {object} opts { repoRoot, assistants: string[], dryRun }
 */
function linkAssistants(opts) {
  const out = {};
  if (opts.assistants.includes("claude")) out.claude = linkClaude(opts.repoRoot, opts);
  if (opts.assistants.includes("kiro")) out.kiro = linkKiro(opts.repoRoot, opts);
  return out;
}

function unlinkAssistants(opts) {
  return { claude: unlinkClaude(opts.repoRoot, opts), kiro: unlinkKiro(opts.repoRoot, opts) };
}

module.exports = {
  cliInPath,
  linkClaude,
  unlinkClaude,
  linkKiro,
  unlinkKiro,
  linkAssistants,
  unlinkAssistants,
};
