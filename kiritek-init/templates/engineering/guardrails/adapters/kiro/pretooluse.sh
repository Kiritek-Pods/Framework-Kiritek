#!/bin/sh
# kiritek-engineering-hook: shim Kiro PreToolUse del pack engineering/guardrails.
# Protocolo Kiro: exit 0 permite, exit 2 bloquea (stderr vuelve al agente).
# Engineering es warning-first: sólo un deny elegible del core devuelve 2;
# cualquier fallo del shim o del CLI PERMITE con aviso (cobertura en Git/CI).
# El evento se trata como dato: no se ejecuta ni se registra su contenido.

set -u
if [ -n "${KIRITEK_ENGINEERING_AGENT_HOOK:-}" ]; then exit 0; fi
KIRITEK_ENGINEERING_AGENT_HOOK=1
export KIRITEK_ENGINEERING_AGENT_HOOK

if ! command -v kiritek-init >/dev/null 2>&1; then
  echo "kiritek engineering: CLI no disponible; no evaluado (cobertura en pre-commit/PR)." >&2
  exit 0
fi
EVENT_FILE=$(mktemp 2>/dev/null) || exit 0
chmod 600 "$EVENT_FILE" 2>/dev/null || true
trap 'rm -f "$EVENT_FILE" 2>/dev/null || true' EXIT INT TERM
cat > "$EVENT_FILE"

kiritek-init guardrails hook kiro --stdin-file="$EVENT_FILE"
CODE=$?
if [ "$CODE" -eq 2 ]; then exit 2; fi
exit 0
