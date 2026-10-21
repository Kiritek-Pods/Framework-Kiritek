"use strict";

/**
 * Adaptador Claude Code mediante hooks `PreToolUse`.
 *
 * Claude Code ejecuta hooks `PreToolUse` ANTES de que una tool corra. El hook
 * recibe por stdin un JSON con el evento y, para denegar/permitir, puede emitir
 * en stdout un bloque `hookSpecificOutput.permissionDecision`.
 *
 * Contrato confirmado (docs.claude.com/.../hooks):
 *  - stdin trae: session_id, cwd, hook_event_name, tool_name, tool_input,
 *    tool_use_id.
 *  - `PreToolUse` devuelve `hookSpecificOutput.permissionDecision` ∈
 *    {allow, deny, ask, defer} + `permissionDecisionReason`.
 *  - `exit 2` BLOQUEA como fail-safe y ni un `allow` posterior lo revierte.
 *  - Precedencia multi-hook: deny > defer > ask > allow.
 *  - Matcher por nombre de tool: `Edit|Write` (escritura), `Bash` (comando),
 *    `mcp__.*` (MCP).
 *  - Las rutas de las file-tools son absolutas con el separador nativo del SO.
 *
 * Este módulo NO imprime ni ejecuta nada por sí mismo: es una función pura que
 * recibe el payload (ya parseado o como texto) y devuelve una DECISIÓN del
 * adaptador (JSON + exit code sugerido). El shim/CLI la ejecuta y aplica el
 * fail-safe. `tool_input` se trata como DATO NO CONFIABLE: nunca se evalúa como
 * shell ni se registran sus valores.
 *
 * Reutiliza el motor compartido (policy/engine), la guarda Git (policy/git), el
 * redactor obligatorio (scanners/redactor) y el contrato de dominio
 * (domain/{policy,result}).
 *
 * (Requisitos 5.1, 6.1, 6.3–6.7, 7.1–7.5, 14.4, 21.10, 26.1, 26.3, G.5, G.12.)
 */

const path = require("path");

const engine = require("../policy/engine.js");
const gitPolicy = require("../policy/git.js");
const result = require("../domain/result.js");
const { redact, findCanaries } = require("../scanners/redactor.js");

const HOOK_EVENT = "PreToolUse";

/** Decisiones de permiso de Claude Code. */
const PERMISSION = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
  ASK: "ask",
  DEFER: "defer",
});

/**
 * Clasificación de la tool interceptada.
 *  - write:   escribe/edita archivos (Edit, Write, MultiEdit, NotebookEdit).
 *  - command: ejecuta un comando de shell (Bash).
 *  - mcp:     tool MCP (mcp__servidor__accion); no interceptable por contenido.
 *  - unknown: fuera de alcance.
 */
const TOOL_KIND = Object.freeze({
  WRITE: "write",
  COMMAND: "command",
  MCP: "mcp",
  UNKNOWN: "unknown",
});

/** Matchers recomendados para el settings de Claude (nombre de tool). */
const MATCHERS = Object.freeze({
  WRITE: "Edit|Write|MultiEdit|NotebookEdit",
  COMMAND: "Bash",
  MCP: "mcp__.*",
});

const WRITE_TOOLS = Object.freeze(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const COMMAND_TOOLS = Object.freeze(["Bash"]);

/**
 * Clasifica una tool por su nombre.
 * @param {string} toolName
 * @returns {string} TOOL_KIND
 */
function classifyTool(toolName) {
  if (typeof toolName !== "string" || toolName.trim() === "") return TOOL_KIND.UNKNOWN;
  if (WRITE_TOOLS.includes(toolName)) return TOOL_KIND.WRITE;
  if (COMMAND_TOOLS.includes(toolName)) return TOOL_KIND.COMMAND;
  if (toolName.startsWith("mcp__")) return TOOL_KIND.MCP;
  return TOOL_KIND.UNKNOWN;
}

/**
 * Normaliza una ruta absoluta (separador nativo) a una ruta relativa POSIX al
 * repositorio, sin permitir escapes del repo. Si la ruta queda fuera del repo
 * se devuelve null (fuera de alcance del gate de archivos del repo).
 *
 * @param {string} absPath   Ruta reportada por la tool (absoluta, nativa).
 * @param {string} repoRoot  Raíz absoluta del repositorio (cwd del evento).
 * @returns {string|null} ruta relativa POSIX o null si escapa del repo.
 */
function normalizeToolPath(absPath, repoRoot) {
  if (typeof absPath !== "string" || absPath.trim() === "") return null;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") return null;

  // Normaliza separadores nativos (Windows "\\") a "/" para un cálculo estable.
  const native = absPath;
  let rel;
  try {
    rel = path.relative(repoRoot, native);
  } catch (_) {
    return null;
  }
  // path.relative puede devolver "" si es el propio root.
  if (rel === "") return null;
  // Normaliza a POSIX.
  const posix = rel.split(path.sep).join("/");
  // Escapa del repo si empieza por "../" o es absoluta tras relativizar.
  if (posix.startsWith("../") || path.isAbsolute(posix)) return null;
  return posix;
}

/**
 * Extrae las rutas candidatas de un `tool_input` de una tool de escritura.
 * Claude expone `file_path` (Edit/Write) o `notebook_path` (NotebookEdit).
 * `tool_input` es dato no confiable: sólo se leen claves de ruta conocidas.
 *
 * @param {object} toolInput
 * @returns {string[]} rutas absolutas candidatas (sin validar aún).
 */
function writePathsFromInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  const out = [];
  for (const key of ["file_path", "notebook_path", "path"]) {
    const v = toolInput[key];
    if (typeof v === "string" && v.trim() !== "") out.push(v);
  }
  // MultiEdit puede traer `edits` sin rutas por edición; la ruta es `file_path`.
  return out;
}

/**
 * Extrae el contenido propuesto de un `tool_input` de escritura, SÓLO para
 * análisis de secretos. No se registra ni se devuelve en ninguna salida.
 *
 * @param {object} toolInput
 * @returns {string|undefined}
 */
function writeContentFromInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return undefined;
  const parts = [];
  for (const key of ["content", "new_string", "new_source"]) {
    const v = toolInput[key];
    if (typeof v === "string") parts.push(v);
  }
  if (Array.isArray(toolInput.edits)) {
    for (const e of toolInput.edits) {
      if (e && typeof e.new_string === "string") parts.push(e.new_string);
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

/**
 * Tokeniza un comando `Bash` en argv SIN usar shell. Esto NO es un parser de
 * shell completo: respeta comillas simples/dobles y separa por espacios, lo
 * suficiente para detectar `git push ... --force/--no-verify`. Ante ambigüedad
 * se es conservador (se preserva el token).
 *
 * El comando se trata como dato: jamás se ejecuta ni se interpola.
 *
 * @param {string} command
 * @returns {string[]} tokens
 */
function tokenizeCommand(command) {
  if (typeof command !== "string") return [];
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(m[2]);
    else tokens.push(m[3]);
  }
  return tokens;
}

/**
 * Extrae los argumentos de git de un comando bash. Si el comando no es `git`
 * (ni contiene un segmento `git` tras un operador), devuelve null.
 *
 * Soporta comandos encadenados simples separados por `&&`, `;` o `|`: evalúa
 * cada segmento y devuelve el PRIMER segmento `git` encontrado. Conservador:
 * cualquier segmento git peligroso debe poder bloquearse.
 *
 * @param {string} command
 * @returns {string[][]} lista de argv de git (sin el token "git").
 */
function gitInvocations(command) {
  const tokens = tokenizeCommand(command);
  const invocations = [];
  let current = [];
  const flush = () => {
    if (current.length && current[0] === "git") {
      invocations.push(current.slice(1));
    }
    current = [];
  };
  for (const t of tokens) {
    if (t === "&&" || t === ";" || t === "|" || t === "||") {
      flush();
      continue;
    }
    current.push(t);
  }
  flush();
  return invocations;
}

/**
 * Mapea una decisión del motor (PolicyResult) a la decisión de permiso de
 * Claude. `deny`/`error` → deny; `warn` → ask (si askOnWarn) o allow; `allow`
 * → allow.
 *
 * @param {object} policyResult
 * @param {object} opts { askOnWarn: boolean }
 * @returns {{ permission: string, blocking: boolean }}
 */
function permissionForDecision(policyResult, opts = {}) {
  const d = policyResult.decision;
  if (d === result.DECISION.DENY || d === result.DECISION.ERROR) {
    return { permission: PERMISSION.DENY, blocking: true };
  }
  if (d === result.DECISION.WARN) {
    return opts.askOnWarn
      ? { permission: PERMISSION.ASK, blocking: false }
      : { permission: PERMISSION.ALLOW, blocking: false };
  }
  return { permission: PERMISSION.ALLOW, blocking: false };
}

/**
 * Resuelve la razón de permiso REDACTADA. Nunca incluye el valor sensible: usa
 * sólo la razón/remediación del PolicyResult (que ya es segura por contrato) y
 * pasa un detector final de canarios. Si quedara un canario, se devuelve un
 * texto genérico seguro (fail-closed).
 *
 * @param {object} policyResult
 * @returns {string}
 */
function redactedReason(policyResult) {
  const base = [policyResult.reason, policyResult.remediation].filter(Boolean).join(" ");
  const text = base || "Operación bloqueada por política de seguridad Kiritek.";
  // redact sanitiza URLs/headers/credenciales embebidas; el detector final
  // garantiza que no se filtre un canario reconocible.
  const safe = typeof redact(text) === "string" ? redact(text) : text;
  if (findCanaries(safe).length > 0) {
    return "Operación bloqueada por política de seguridad Kiritek (detalle redactado).";
  }
  return safe;
}

/**
 * Evalúa un evento `PreToolUse` ya parseado y normalizado.
 *
 * @param {object} event
 * @param {string} event.hook_event_name
 * @param {string} event.tool_name
 * @param {object} event.tool_input
 * @param {string} event.cwd            Raíz del workspace (repo root).
 * @param {object} [opts]
 * @param {string} [opts.mode]          warning|enforce
 * @param {string|null} [opts.defaultBranch]
 * @param {string} [opts.forcePolicy]   deny|lease-only|allow
 * @param {boolean} [opts.askOnWarn]    Mapear warn → ask (riesgo medio).
 * @param {object[]} [opts.exceptions]
 * @returns {{ decision, permission, blocking, controlId, policyResult, kind, reason }}
 */
function evaluateEvent(event, opts = {}) {
  const mode = opts.mode === "enforce" ? "enforce" : "warning";
  const forcePolicy = opts.forcePolicy || "deny";
  const askOnWarn = opts.askOnWarn === true;
  const repoRoot = event && typeof event.cwd === "string" ? event.cwd : "";
  const kind = classifyTool(event && event.tool_name);

  if (kind === TOOL_KIND.WRITE) {
    const absPaths = writePathsFromInput(event.tool_input);
    const content = writeContentFromInput(event.tool_input);
    const files = [];
    for (const abs of absPaths) {
      const rel = normalizeToolPath(abs, repoRoot);
      // Si la ruta escapa del repo, se evalúa igual por su basename para no
      // perder protección de archivos sensibles (p. ej. ~/.aws/credentials).
      files.push({ path: rel || path.basename(abs), content });
    }
    const policyResult = engine.evaluateFiles(
      { event: "tool-write", mode, files },
      { exceptions: opts.exceptions || [] }
    );
    const { permission, blocking } = permissionForDecision(policyResult, { askOnWarn });
    return {
      decision: policyResult.decision,
      permission,
      blocking,
      controlId: policyResult.controlId,
      policyResult,
      kind,
      reason: blocking || permission === PERMISSION.ASK ? redactedReason(policyResult) : null,
    };
  }

  if (kind === TOOL_KIND.COMMAND) {
    const command = event.tool_input && typeof event.tool_input.command === "string"
      ? event.tool_input.command
      : "";
    const invocations = gitInvocations(command);
    // Evalúa cada invocación git; la primera que bloquee gana (precedencia deny).
    let worst = null;
    for (const args of invocations) {
      const pr = gitPolicy.evaluateGitCommand({
        args,
        mode,
        defaultBranch: opts.defaultBranch || null,
        forcePolicy,
      });
      if (pr.decision === result.DECISION.DENY || pr.decision === result.DECISION.ERROR) {
        worst = pr;
        break;
      }
      if (!worst || result.compareSeverity(pr.severity, worst.severity) > 0) {
        if (pr.decision !== result.DECISION.ALLOW) worst = pr;
      }
    }
    const policyResult =
      worst ||
      result.createResult({
        controlId: gitPolicy.CONTROL_ID,
        decision: result.DECISION.ALLOW,
        toolStatus: result.TOOL_STATUS.NOT_APPLICABLE,
      });
    const { permission, blocking } = permissionForDecision(policyResult, { askOnWarn });
    return {
      decision: policyResult.decision,
      permission,
      blocking,
      controlId: policyResult.controlId,
      policyResult,
      kind,
      reason: blocking || permission === PERMISSION.ASK ? redactedReason(policyResult) : null,
    };
  }

  // MCP y tools desconocidas: no interceptables por contenido. No se atribuye
  // protección falsa; se permite (no es nuestro alcance) pero se marca el
  // estado de capacidad para la auditoría.
  return {
    decision: result.DECISION.ALLOW,
    permission: PERMISSION.ALLOW,
    blocking: false,
    controlId: null,
    policyResult: null,
    kind,
    reason: null,
    uninterceptable: kind === TOOL_KIND.MCP || kind === TOOL_KIND.UNKNOWN,
  };
}

/**
 * Construye el objeto de salida que Claude espera para `PreToolUse`.
 *
 * @param {object} evalResult  Salida de evaluateEvent.
 * @returns {object} { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
 */
function buildHookOutput(evalResult) {
  const hookSpecificOutput = {
    hookEventName: HOOK_EVENT,
    permissionDecision: evalResult.permission,
  };
  if (evalResult.reason) {
    hookSpecificOutput.permissionDecisionReason = evalResult.reason;
  }
  return { hookSpecificOutput };
}

/**
 * Parsea el stdin del hook de forma defensiva. Devuelve `{ ok, event }` o
 * `{ ok:false, error }` sin lanzar: el llamador decide el fail-safe (exit 2).
 *
 * @param {string} raw
 * @returns {{ ok: boolean, event?: object, error?: string }}
 */
function parseStdin(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "EMPTY_STDIN" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { ok: false, error: "INVALID_JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "NOT_AN_OBJECT" };
  }
  if (parsed.hook_event_name !== undefined && parsed.hook_event_name !== HOOK_EVENT) {
    return { ok: false, error: "WRONG_EVENT" };
  }
  if (typeof parsed.tool_name !== "string") {
    return { ok: false, error: "MISSING_TOOL_NAME" };
  }
  return { ok: true, event: parsed };
}

module.exports = {
  HOOK_EVENT,
  PERMISSION,
  TOOL_KIND,
  MATCHERS,
  WRITE_TOOLS,
  COMMAND_TOOLS,
  classifyTool,
  normalizeToolPath,
  writePathsFromInput,
  writeContentFromInput,
  tokenizeCommand,
  gitInvocations,
  permissionForDecision,
  redactedReason,
  evaluateEvent,
  buildHookOutput,
  parseStdin,
};
