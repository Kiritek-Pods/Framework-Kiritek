# Adaptador Claude Code (hooks `PreToolUse`)

Este adaptador conecta el gate de seguridad de Kiritek a Claude Code mediante
hooks `PreToolUse`. Es **independiente** del adaptador de Kiro: puede instalarse
solo, y cuando ambos están activos no hay doble ejecución porque cada uno corre
en su propio motor de hooks (Claude dispara los suyos; Kiro los suyos).

## Qué intercepta

| Matcher | Tools | Control |
| --- | --- | --- |
| `Edit\|Write\|MultiEdit\|NotebookEdit` | escritura de archivos | archivos sensibles (`.env`, claves, credenciales) por ruta y contenido |
| `Bash` | comandos de shell | `git push` directo a la rama default, `--force`/`+refspec` peligroso, `--no-verify` |
| `mcp__.*` | tools MCP | **no interceptable por contenido**: se marca `unavailable` en auditoría, sin atribuir protección falsa |

## Contrato de decisión

El shim (`pretooluse.sh`) reenvía el evento (stdin JSON) al CLI core
(`kiritek-init validate claude-hook`). El core mapea la decisión del motor:

- `deny`/`error` → `permissionDecision: "deny"` con razón **redactada** + **exit 2**.
- riesgo medio configurable → `permissionDecision: "ask"`.
- política permite → `permissionDecision: "allow"`.

`exit 2` bloquea como **fail-safe**: ni un `allow` posterior lo revierte, y la
precedencia multi-hook es `deny > defer > ask > allow`. Ante cualquier fallo del
hook (CLI ausente, stdin vacío/ilegible, JSON inválido, error de evaluación o
redacción insuficiente) el shim **bloquea con exit 2**, nunca permite por defecto.

## Privacidad

El `tool_input` se trata como dato **no confiable**: nunca se ejecuta como
shell, nunca se registra, y `permissionDecisionReason` pasa por el redactor
obligatorio (fail-closed). Prompts, código y valores no aparecen en logs ni en
stderr.

## Detección de versión / capacidad

Las operaciones que Claude no expone a `PreToolUse` (p. ej. acciones MCP cuyo
efecto no puede inspeccionarse por contenido) se declaran `unavailable` en la
auditoría de capacidades, en lugar de simular enforcement. La instalación,
actualización y desinstalación son **ownership-aware**: sólo se tocan artefactos
propiedad de Kiritek y se preservan los hooks/ajustes previos del usuario.

## Archivos

- `.kiritek/adapters/claude/pretooluse.sh` — shim con guard anti-recursión y fail-safe.
- `.claude/settings.json` — se fusiona el bloque `hooks.PreToolUse` sin sobrescribir.
