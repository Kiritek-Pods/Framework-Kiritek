"use strict";

/**
 * Adaptador Kiro mediante hooks `.kiro/hooks/*.json` (formato `version: v1`).
 *
 * Kiro ejecuta hooks `PreToolUse` ANTES de que una tool corra. El hook recibe
 * por stdin un JSON con el evento y DECIDE POR EXIT CODE (no por un bloque
 * `permissionDecision` como Claude Code):
 *
 * Contrato confirmado (kiro.dev/docs/hooks):
 *  - `PreToolUse` con acción `command` que termina en **exit 2 BLOQUEA** la tool
 *    y devuelve `stderr` al agente; **exit 0 PERMITE**; cualquier otro código se
 *    trata como fallo del hook y la tool **continúa** (no bloqueante).
 *  - Por tanto `deny → exit 2`, `allow`/`warn → exit 0`, y JAMÁS se usa un código
 *    arbitrario para denegar (Kiro lo trataría como fallo no bloqueante).
 *  - NO existe modo `ask` ni `permissionDecision` en `PreToolUse` (eso es de
 *    Claude Code). El adaptador NO depende de confirmación interactiva.
 *  - stdin trae: `hook_event_name`, `cwd`, `session_id`, `tool_name`,
 *    `tool_input`. (`tool_response` sólo en `PostToolUse`.)
 *  - Matcher es un regex contra el nombre de la tool; hooks por workspace,
 *    activados al iniciar sesión.
 *
 * Este módulo NO imprime ni ejecuta nada por sí mismo: es una función pura que
 * recibe el payload (ya parseado o como texto) y devuelve una DECISIÓN del
 * adaptador (exit code sugerido + razón redactada). El shim/CLI la ejecuta y
 * aplica el fail-safe. `tool_input` se trata como DATO NO CONFIABLE: nunca se
 * evalúa como shell ni se registran sus valores (prompts, código, secretos).
 *
 * Reutiliza EXACTAMENTE el mismo core que el adaptador Claude: el motor
 * compartido (policy/engine), la guarda Git (policy/git), el redactor
 * obligatorio (scanners/redactor) y el contrato de dominio (domain/result). No
 * duplica reglas de política ni depende del adaptador Claude.
 *
 * (Requisitos 5.1, 6.2–6.7, 7.1–7.5, 14.4, 14.5, 21.10, 26.1, 26.3, G.5, G.12.)
 */

const path = require("path");

const engine = require("../policy/engine.js");
const gitPolicy = require("../policy/git.js");
const result = require("../domain/result.js");
const { redact, findCanaries } = require("../scanners/redactor.js");

const HOOK_EVENT = "PreToolUse";

/** Versión de formato de hooks de Kiro que este adaptador genera/soporta. */
const HOOK_FORMAT_VERSION = "v1";

/** Exit codes del contrato de Kiro para `PreToolUse`. */
const EXIT = Object.freeze({
  ALLOW: 0, // Kiro permite la tool.
  BLOCK: 2, // Kiro bloquea la tool (único código de denegación válido).
});

/**
 * Clasificación de la tool interceptada.
 *  - write:   escribe/edita archivos (fs_write/write, str_replace).
 *  - command: ejecuta un comando (execute_bash/shell) o AWS (use_aws).
 *  - unknown: fuera de alcance (no interceptable por contenido).
 */
const TOOL_KIND = Object.freeze({
  WRITE: "write",
  COMMAND: "command",
  UNKNOWN: "unknown",
});

/** Nombres de tools de escritura reconocidos (y sus alias documentados). */
const WRITE_TOOLS = Object.freeze(["fs_write", "write", "str_replace"]);
/** Nombres de tools de comando reconocidos (shell y AWS). */
const COMMAND_TOOLS = Object.freeze(["execute_bash", "shell", "use_aws"]);

/**
 * Matchers recomendados para los hooks de Kiro (regex contra el nombre de la
 * tool). Se agrupan por tipo para generar un hook por grupo.
 */
const MATCHERS = Object.freeze({
  WRITE: "fs_write|write|str_replace",
  COMMAND: "execute_bash|shell|use_aws",
});

/**
 * Clasifica una tool por su nombre.
 * @param {string} toolName
 * @returns {string} TOOL_KIND
 */
function classifyTool(toolName) {
  if (typeof toolName !== "string" || toolName.trim() === "") return TOOL_KIND.UNKNOWN;
  if (WRITE_TOOLS.includes(toolName)) return TOOL_KIND.WRITE;
  if (COMMAND_TOOLS.includes(toolName)) return TOOL_KIND.COMMAND;
  return TOOL_KIND.UNKNOWN;
}

/**
 * Normaliza una ruta reportada por la tool a una ruta relativa POSIX al
 * repositorio, sin permitir escapes del repo. Las rutas de Kiro pueden llegar
 * absolutas o relativas al `cwd`; se resuelven contra `repoRoot` de forma
 * estable. Si la ruta queda fuera del repo se devuelve null.
 *
 * @param {string} toolPath  Ruta reportada por la tool (absoluta o relativa).
 * @param {string} repoRoot  Raíz absoluta del workspace (cwd del evento).
 * @returns {string|null} ruta relativa POSIX o null si escapa del repo.
 */
function normalizeToolPath(toolPath, repoRoot) {
  if (typeof toolPath !== "string" || toolPath.trim() === "") return null;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") return null;

  // Las rutas relativas se resuelven contra el repoRoot; las absolutas quedan
  // tal cual. No se asume separador: path.resolve usa el nativo.
  const resolved = path.isAbsolute(toolPath) ? toolPath : path.resolve(repoRoot, toolPath);
  let rel;
  try {
    rel = path.relative(repoRoot, resolved);
  } catch (_) {
    return null;
  }
  if (rel === "") return null;
  const posix = rel.split(path.sep).join("/");
  if (posix.startsWith("../") || path.isAbsolute(posix)) return null;
  return posix;
}

/**
 * Extrae las rutas candidatas de un `tool_input` de una tool de escritura.
 * Sólo se leen claves de ruta DOCUMENTADAS (`path`); `tool_input` es dato no
 * confiable y no se asumen claves no documentadas.
 *
 * @param {object} toolInput
 * @returns {string[]} rutas candidatas (sin validar aún).
 */
function writePathsFromInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  const out = [];
  // `fs_write`, `str_replace` y `write` exponen la ruta en `path`.
  // Se tolera `file_path` por robustez, sin asumir que exista.
  for (const key of ["path", "file_path"]) {
    const v = toolInput[key];
    if (typeof v === "string" && v.trim() !== "") out.push(v);
  }
  return out;
}

/**
 * Extrae el contenido propuesto de un `tool_input` de escritura, SÓLO para
 * análisis de secretos. No se registra ni se devuelve en ninguna salida.
 *
 * Para `fs_write` el contenido llega en `text`/`content`; para `str_replace`
 * el texto nuevo llega en `new_str`/`newStr`.
 *
 * @param {object} toolInput
 * @returns {string|undefined}
 */
function writeContentFromInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return undefined;
  const parts = [];
  for (const key of ["text", "content", "new_str", "newStr"]) {
    const v = toolInput[key];
    if (typeof v === "string") parts.push(v);
  }
  return parts.length ? parts.join("\n") : undefined;
}

/**
 * Tokeniza un comando en argv SIN usar shell. No es un parser de shell
 * completo: respeta comillas simples/dobles y separa por espacios, lo
 * suficiente para detectar `git push ... --force/--no-verify`. Ante ambigüedad
 * se es conservador (se preserva el token). El comando se trata como dato:
 * jamás se ejecuta ni se interpola.
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
 * Extrae las invocaciones de git de un comando. Soporta comandos encadenados
 * simples (`&&`, `;`, `|`, `||`); devuelve el argv de CADA segmento `git`
 * (sin el token "git"). Conservador: cualquier segmento git peligroso debe
 * poder bloquearse.
 *
 * @param {string} command
 * @returns {string[][]}
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
 * Extrae el comando de shell de un `tool_input` de comando. `execute_bash`/
 * `shell` exponen `command`. `use_aws` NO ejecuta git ni toca archivos del
 * repo: se trata como no interceptable por contenido (devuelve "").
 *
 * @param {object} toolInput
 * @returns {string}
 */
function commandFromInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (typeof toolInput.command === "string") return toolInput.command;
  return "";
}

/**
 * Mapea una decisión del motor (PolicyResult) al exit code de Kiro.
 *  - `deny`/`error` → exit 2 (bloquea), blocking:true.
 *  - `warn`/`allow` → exit 0 (permite), blocking:false. (No hay `ask` en Kiro.)
 *
 * @param {object} policyResult
 * @returns {{ exitCode: number, blocking: boolean }}
 */
function exitForDecision(policyResult) {
  const d = policyResult.decision;
  if (d === result.DECISION.DENY || d === result.DECISION.ERROR) {
    return { exitCode: EXIT.BLOCK, blocking: true };
  }
  return { exitCode: EXIT.ALLOW, blocking: false };
}

/**
 * Resuelve la razón de bloqueo REDACTADA para stderr. Nunca incluye el valor
 * sensible: usa sólo la razón/remediación del PolicyResult (segura por
 * contrato) y pasa un detector final de canarios. Si quedara un canario,
 * devuelve un texto genérico seguro (fail-closed).
 *
 * @param {object} policyResult
 * @returns {string}
 */
function redactedReason(policyResult) {
  const base = [policyResult.reason, policyResult.remediation].filter(Boolean).join(" ");
  const text = base || "Operación bloqueada por política de seguridad Kiritek.";
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
 * @param {object[]} [opts.exceptions]
 * @returns {{ decision, exitCode, blocking, controlId, policyResult, kind, reason, uninterceptable? }}
 */
function evaluateEvent(event, opts = {}) {
  const mode = opts.mode === "enforce" ? "enforce" : "warning";
  const forcePolicy = opts.forcePolicy || "deny";
  const repoRoot = event && typeof event.cwd === "string" ? event.cwd : "";
  const kind = classifyTool(event && event.tool_name);

  if (kind === TOOL_KIND.WRITE) {
    const toolPaths = writePathsFromInput(event.tool_input);
    const content = writeContentFromInput(event.tool_input);
    const files = [];
    for (const p of toolPaths) {
      const rel = normalizeToolPath(p, repoRoot);
      // Si la ruta escapa del repo, se evalúa por su basename para no perder la
      // protección de archivos sensibles (p. ej. ~/.aws/credentials).
      files.push({ path: rel || path.basename(p), content });
    }
    const policyResult = engine.evaluateFiles(
      { event: "tool-write", mode, files },
      { exceptions: opts.exceptions || [] }
    );
    const { exitCode, blocking } = exitForDecision(policyResult);
    return {
      decision: policyResult.decision,
      exitCode,
      blocking,
      controlId: policyResult.controlId,
      policyResult,
      kind,
      reason: blocking ? redactedReason(policyResult) : null,
    };
  }

  if (kind === TOOL_KIND.COMMAND) {
    const command = commandFromInput(event.tool_input);
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
    const { exitCode, blocking } = exitForDecision(policyResult);
    return {
      decision: policyResult.decision,
      exitCode,
      blocking,
      controlId: policyResult.controlId,
      policyResult,
      kind,
      // `use_aws` y comandos sin git no son interceptables por contenido aquí:
      // se permiten (exit 0) y Git/CI siguen cubriendo el control.
      reason: blocking ? redactedReason(policyResult) : null,
    };
  }

  // Tools desconocidas / fuera de alcance: no interceptables por contenido. No
  // se atribuye protección falsa; se permite (exit 0) pero se marca para la
  // auditoría de capacidades.
  return {
    decision: result.DECISION.ALLOW,
    exitCode: EXIT.ALLOW,
    blocking: false,
    controlId: null,
    policyResult: null,
    kind,
    reason: null,
    uninterceptable: true,
  };
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

/**
 * Construye la definición de un archivo de hook de Kiro `.kiro/hooks/*.json`
 * (formato `version: v1`) para un grupo de tools. La acción `command` invoca el
 * CLI core; Kiro decide por exit code (0 permite, 2 bloquea).
 *
 * @param {object} spec
 * @param {string} spec.name     Nombre descriptivo del hook.
 * @param {string} spec.matcher  Regex contra el nombre de la tool.
 * @param {string} spec.command  Comando a ejecutar (invoca el CLI core).
 * @returns {object} definición de hook v1.
 */
function buildHookDefinition(spec) {
  return {
    version: HOOK_FORMAT_VERSION,
    hooks: [
      {
        name: spec.name,
        trigger: HOOK_EVENT,
        matcher: spec.matcher,
        action: {
          type: "command",
          command: spec.command,
        },
      },
    ],
  };
}

module.exports = {
  HOOK_EVENT,
  HOOK_FORMAT_VERSION,
  EXIT,
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
  commandFromInput,
  exitForDecision,
  redactedReason,
  evaluateEvent,
  parseStdin,
  buildHookDefinition,
};
