"use strict";

/**
 * Parseo de eventos `PreToolUse` de agentes (Kiro, Claude) para el pack
 * engineering (T14.1–T14.3, T14.8). Independiente de los adaptadores de
 * security: no importa nada de `core/security`.
 *
 * `tool_input` es DATO NO CONFIABLE: sólo se leen claves de ruta conocidas;
 * contenido, comandos y prompts nunca salen de esta función (R13.7). Un
 * payload malformado no lanza: devuelve `{ ok:false, code }` y el adaptador
 * permite con feedback (engineering nunca es fail-closed por un error).
 */

const path = require("node:path");

const MAX_EVENT_BYTES = 1024 * 1024;

/** Tools por superficie: escritura (interceptable por ruta) y no interceptables. */
const TOOLS = Object.freeze({
  kiro: { write: ["fs_write", "write", "str_replace"], opaque: ["execute_bash", "shell", "use_aws"] },
  claude: { write: ["Edit", "Write", "MultiEdit", "NotebookEdit"], opaque: ["Bash"], opaquePrefix: "mcp__" },
});
const PATH_KEYS = Object.freeze(["path", "file_path", "notebook_path"]);

/** Ruta del evento → relativa POSIX al repo, o null si sale del repo. */
function toRepoPath(raw, repoRoot) {
  if (typeof raw !== "string" || !raw.trim() || raw.includes("\0")) return null;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * @param {string|object} raw     stdin del hook (texto o ya parseado)
 * @param {"kiro"|"claude"} surface
 * @param {string} repoRoot
 * @returns {{ok:true, kind:"write"|"opaque"|"unknown", toolName, paths:string[], outside:number} | {ok:false, code}}
 */
function parseAgentEvent(raw, surface, repoRoot) {
  let event = raw;
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw) > MAX_EVENT_BYTES) return { ok: false, code: "EVENT_TOO_LARGE" };
    try {
      event = JSON.parse(raw);
    } catch (_) {
      return { ok: false, code: "EVENT_UNPARSEABLE" };
    }
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, code: "EVENT_INVALID" };
  const toolName = event.tool_name;
  if (typeof toolName !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(toolName)) return { ok: false, code: "EVENT_TOOL_INVALID" };
  const tools = TOOLS[surface];
  if (!tools) return { ok: false, code: "SURFACE_UNKNOWN" };
  let kind = "unknown";
  if (tools.write.includes(toolName)) kind = "write";
  else if (tools.opaque.includes(toolName) || (tools.opaquePrefix && toolName.startsWith(tools.opaquePrefix))) kind = "opaque";
  const paths = [];
  let outside = 0;
  if (kind === "write") {
    const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
    for (const k of PATH_KEYS) {
      if (typeof input[k] !== "string") continue;
      const rel = toRepoPath(input[k], repoRoot);
      if (rel) paths.push(rel);
      else outside += 1;
    }
  }
  return { ok: true, kind, toolName, paths: [...new Set(paths)].sort(), outside };
}

module.exports = { TOOLS, parseAgentEvent, toRepoPath };
