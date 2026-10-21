#!/bin/sh
# kiritek-engineering-hook: shim Claude Code PreToolUse del pack engineering.
# Protocolo nativo: JSON con hookSpecificOutput.permissionDecision en stdout
# y exit 0. Engineering nunca usa exit 2: un fallo PERMITE con aviso.

set -u
if [ -n "${KIRITEK_ENGINEERING_AGENT_HOOK:-}" ]; then exit 0; fi
KIRITEK_ENGINEERING_AGENT_HOOK=1
export KIRITEK_ENGINEERING_AGENT_HOOK

if ! command -v kiritek-init >/dev/null 2>&1; then exit 0; fi
EVENT_FILE=$(mktemp 2>/dev/null) || exit 0
chmod 600 "$EVENT_FILE" 2>/dev/null || true
trap 'rm -f "$EVENT_FILE" 2>/dev/null || true' EXIT INT TERM
cat > "$EVENT_FILE"

kiritek-init guardrails hook claude --stdin-file="$EVENT_FILE"
exit 0
