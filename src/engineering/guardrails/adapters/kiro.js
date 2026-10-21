"use strict";

/**
 * Adaptador Kiro engineering (T14.2). Protocolo nativo de `PreToolUse`:
 * exit 0 permite, exit 2 bloquea (stderr vuelve al agente). Kiro no tiene
 * modo `ask`: no se inventa. allow/warn ⇒ 0 con feedback; sólo un deny
 * elegible ⇒ 2. Errores (payload malformado, CLI/evaluación fallida) ⇒ 0
 * con feedback: engineering nunca convierte un fallo en bloqueo.
 */

const EXIT = Object.freeze({ ALLOW: 0, BLOCK: 2 });
const MAX_LINES = 8;

function feedback(lines) {
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`… y ${lines.length - MAX_LINES} más`);
  return shown.map((l) => `kiritek engineering: ${l}`).join("\n");
}

/** @param {{decision, messages}} decision  salida de agentDecision */
function kiroResponse(decision) {
  if (decision.decision === "deny") return { exitCode: EXIT.BLOCK, stderr: feedback(decision.messages), stdout: "" };
  return { exitCode: EXIT.ALLOW, stderr: decision.messages.length ? feedback(decision.messages) : "", stdout: "" };
}

/** Evento ilegible / evaluación no disponible: permitir y declarar cobertura posterior. */
function kiroUnavailable(code) {
  return { exitCode: EXIT.ALLOW, stderr: feedback([`evaluación no disponible (${code}); la cobertura queda en pre-commit/PR`]), stdout: "" };
}

module.exports = { EXIT, kiroResponse, kiroUnavailable };
