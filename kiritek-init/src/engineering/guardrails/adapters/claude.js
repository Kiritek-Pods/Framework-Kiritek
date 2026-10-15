"use strict";

/**
 * Adaptador Claude Code engineering (T14.3). Protocolo nativo: JSON en
 * stdout con `hookSpecificOutput.permissionDecision` (allow|ask|deny) y exit 0.
 *
 * - deny sólo si el core emitió un deny elegible.
 * - warn ⇒ `allow` (default) o `ask` si la config lo pide (`warnAs`); nunca
 *   `deny`: una heurística no se eleva a denegación central (R13.3).
 * - Errores ⇒ `allow` con razón (nunca bloquea por fallo propio).
 */

const PERMISSION = Object.freeze({ ALLOW: "allow", ASK: "ask", DENY: "deny" });

function reasonOf(lines) {
  const shown = lines.slice(0, 8);
  if (lines.length > 8) shown.push(`… y ${lines.length - 8} más`);
  return shown.join("; ");
}

function output(permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(reason ? { permissionDecisionReason: `kiritek engineering: ${reason}` } : {}),
    },
  };
}

/**
 * @param {{decision, messages}} decision  salida de agentDecision
 * @param {{warnAs?: "allow"|"ask"}} [opts]
 */
function claudeResponse(decision, opts = {}) {
  const warnAs = opts.warnAs === "ask" ? PERMISSION.ASK : PERMISSION.ALLOW;
  let permission = PERMISSION.ALLOW;
  if (decision.decision === "deny") permission = PERMISSION.DENY;
  else if (decision.decision === "warn") permission = warnAs;
  return { exitCode: 0, stdout: JSON.stringify(output(permission, decision.messages.length ? reasonOf(decision.messages) : "")), stderr: "" };
}

function claudeUnavailable(code) {
  return { exitCode: 0, stdout: JSON.stringify(output(PERMISSION.ALLOW, `evaluación no disponible (${code}); la cobertura queda en pre-commit/PR`)), stderr: "" };
}

module.exports = { PERMISSION, claudeResponse, claudeUnavailable };
