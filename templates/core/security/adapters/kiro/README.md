# Adaptador Kiro (hooks `.kiro/hooks/*.json`, formato `version: v1`)

Este adaptador conecta el gate de seguridad de Kiritek a Kiro mediante hooks
`PreToolUse` por workspace. Es **independiente** del adaptador de Claude Code:
puede instalarse solo, y cuando ambos están activos **no hay doble ejecución**
porque cada uno corre en su propio motor de hooks (Claude dispara los suyos;
Kiro los suyos) con guardas anti-recursión separadas.

## Qué intercepta

| Matcher (regex por nombre de tool) | Tools | Control |
| --- | --- | --- |
| `fs_write\|write\|str_replace` | escritura/edición de archivos | archivos sensibles (`.env`, claves, credenciales) por ruta y contenido |
| `execute_bash\|shell\|use_aws` | comandos de shell / AWS | `git push` directo a la rama default, `--force`/`+refspec` peligroso, `--no-verify` |

Como el catálogo de tools de Kiro no es cerrado, el adaptador incluye las tools
conocidas y degrada a `unavailable` lo que no puede interceptar por contenido,
en lugar de asumir cobertura total. `use_aws` y los comandos sin `git` no se
bloquean por este adaptador: Git y CI siguen cubriendo esos controles.

## Contrato de decisión (POR EXIT CODE)

El shim (`pretooluse.sh`) reenvía el evento (stdin JSON) al CLI core
(`kiritek-init validate kiro-hook`). A diferencia de Claude Code, Kiro **no usa**
un bloque `permissionDecision` ni tiene modo `ask`: decide por **exit code**.

- `deny`/`error` del motor → **exit 2** (bloquea la tool; `stderr` redactado llega
  al agente con causa/ruta/remediación).
- `allow`/`warn` → **exit 0** (permite). No hay confirmación intermedia.
- Cualquier **otro** código Kiro lo trata como **fallo del hook NO bloqueante**
  y la tool continúa. Por eso el core y el shim resuelven SIEMPRE a 0 ó 2.

Ante cualquier fallo del hook (CLI ausente, stdin vacío/ilegible, JSON inválido,
error de evaluación o redacción insuficiente) el shim **bloquea con exit 2**,
nunca permite por defecto (fail-safe/fail-closed).

> Limitación honesta: como Kiro ignora como "no bloqueante" cualquier código
> distinto de 2, un bloqueo real sólo se garantiza devolviendo deliberadamente
> exit 2. El shim lo hace para payloads malformados y para cualquier resultado
> inesperado del core.

## Privacidad

El `tool_input` se trata como dato **no confiable**: nunca se ejecuta como
shell, nunca se registra, y los mensajes de `stderr` pasan por el redactor
obligatorio (fail-closed). Prompts, código y valores no aparecen en logs,
`stderr` ni evidencia.

## Detección de versión / formato

Los hooks se generan en formato `version: v1`. Si una versión de Kiro no soporta
el formato o el bloqueo por exit 2, la auditoría de capacidades marca la capa
`unavailable` en lugar de simular enforcement; Git/CI siguen cubriendo el
control. Las migraciones por cambios de API tocan **sólo** el adaptador y
preservan los hooks e integraciones del usuario.

## Archivos

- `.kiritek/adapters/kiro/pretooluse.sh` — shim con guard anti-recursión y fail-safe.
- `.kiro/hooks/kiritek-security-write.kiro.hook.json` — hook de escritura (v1).
- `.kiro/hooks/kiritek-security-command.kiro.hook.json` — hook de comando (v1).

La instalación/actualización/desinstalación es **ownership-aware**: sólo se tocan
los archivos propiedad de Kiritek y se preservan los hooks previos del usuario.
