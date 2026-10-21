#!/bin/sh
# Kiritek managed Kiro PreToolUse hook (shim).
#
# Kiro invoca este shim ANTES de ejecutar una tool (fs_write/write/str_replace,
# execute_bash/shell, use_aws). El evento llega por stdin como JSON
# (hook_event_name, cwd, session_id, tool_name, tool_input). El shim lo reenvía
# al CLI core de Kiritek, que decide permitir/denegar POR EXIT CODE.
#
# Contrato de bloqueo (kiro.dev/docs/hooks): exit 2 BLOQUEA la tool y devuelve
# stderr al agente; exit 0 PERMITE; cualquier OTRO código se trata como fallo
# del hook y la tool CONTINÚA (no bloqueante). Por eso este shim SIEMPRE termina
# en 0 (permitir) o 2 (bloquear): ante cualquier fallo (CLI ausente, error de
# evaluación, stdin ilegible) termina en exit 2, nunca permite por defecto.
#
# No ejecuta ni interpola el contenido del evento: lo trata como dato.

set -u

# Guard anti-recursión INDEPENDIENTE de Claude: evita que las sub-invocaciones
# del gate (git, scan) re-disparen este hook y causen doble ejecución. No
# comparte variable con el shim de Claude.
if [ -n "${KIRITEK_KIRO_HOOK_RUNNING:-}" ]; then
  exit 0
fi
KIRITEK_KIRO_HOOK_RUNNING=1
export KIRITEK_KIRO_HOOK_RUNNING

# Capturar el evento (stdin se consume una sola vez).
EVENT_FILE=$(mktemp 2>/dev/null) || {
  # Sin temp seguro no podemos evaluar; fail-safe: bloquear.
  printf '%s\n' 'kiritek: no se pudo preparar la evaluacion; bloqueado por seguridad.' 1>&2
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
  printf '%s\n' 'kiritek: no disponible; bloqueado por seguridad.' 1>&2
  exit 2
fi

# Delegar en el core. El CLI usa exit 0 para permitir y exit 2 para bloquear;
# stderr lleva la causa/ruta/remediacion redactadas.
kiritek-init validate kiro-hook --format=json --stdin-file="$EVENT_FILE"
CODE=$?

# Preservar sólo 0/2. Cualquier otro código inesperado del core se trata como
# fallo → fail-safe: bloquear con exit 2 (Kiro trataría otro código como fallo
# NO bloqueante, lo que dejaría pasar la tool).
if [ "$CODE" -eq 0 ]; then
  exit 0
fi
printf '%s\n' 'kiritek: operacion bloqueada por politica de seguridad.' 1>&2
exit 2
