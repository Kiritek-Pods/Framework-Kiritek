#!/bin/sh
# Kiritek managed Claude Code PreToolUse hook (shim).
#
# Claude Code invoca este shim ANTES de ejecutar una tool (Edit/Write/Bash/mcp).
# El evento llega por stdin como JSON (session_id, cwd, hook_event_name,
# tool_name, tool_input, tool_use_id). El shim lo reenvía al CLI core de Kiritek,
# que decide permitir/preguntar/denegar y emite el bloque hookSpecificOutput.
#
# Contrato de bloqueo (docs.claude.com/.../hooks): exit 2 BLOQUEA como fail-safe
# y ni un allow lo revierte. Por eso, ante CUALQUIER fallo (CLI ausente, error de
# evaluación, stdin ilegible) este shim termina en exit 2: nunca permite por
# defecto.
#
# No ejecuta ni interpola el contenido del evento: lo trata como dato.

set -u

# Guard anti-recursión: evita que las sub-invocaciones del gate (git, scan)
# re-disparen este hook y causen doble ejecución.
if [ -n "${KIRITEK_CLAUDE_HOOK_RUNNING:-}" ]; then
  exit 0
fi
KIRITEK_CLAUDE_HOOK_RUNNING=1
export KIRITEK_CLAUDE_HOOK_RUNNING

# Capturar el evento (stdin se consume una sola vez).
EVENT_FILE=$(mktemp 2>/dev/null) || {
  # Sin temp seguro no podemos evaluar; fail-safe: bloquear.
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"No se pudo preparar la evaluacion; bloqueado por seguridad."}}'
  exit 2
}
# Permisos restrictivos para el archivo temporal.
chmod 600 "$EVENT_FILE" 2>/dev/null || true
cat > "$EVENT_FILE"

cleanup() {
  rm -f "$EVENT_FILE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! command -v kiritek-init >/dev/null 2>&1; then
  # El CLI no está disponible: no podemos evaluar la política. Fail-safe:
  # bloquear en vez de permitir en silencio (nunca atribuir protección falsa).
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Kiritek no disponible; bloqueado por seguridad."}}'
  exit 2
fi

# Delegar en el core. El CLI emite el JSON por stdout y usa exit 2 para bloquear.
kiritek-init validate claude-hook --format=json --stdin-file="$EVENT_FILE"
CODE=$?

# Preservar el exit code del core (0 permite/ask, 2 bloquea). Cualquier otro
# código inesperado se trata como fallo → fail-safe: bloquear.
if [ "$CODE" -eq 0 ]; then
  exit 0
fi
if [ "$CODE" -eq 2 ]; then
  exit 2
fi
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Resultado inesperado del gate; bloqueado por seguridad."}}'
exit 2
