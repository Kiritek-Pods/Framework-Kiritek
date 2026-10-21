# Changelog de seguridad — Kiritek

Cambios de seguridad de `kiritek-init`, trazables por **impacto**,
**enforcement** y **migración**. Es parte del hub [`SECURITY.md`](./SECURITY.md).

Formato: cada entrada registra qué cambió, su impacto, si altera el enforcement
por defecto y qué pasos de migración exige. El versionado es semántico (ver
[`RELEASE.md`](./RELEASE.md)).

Convención de columnas:

- **Impacto** — alcance del cambio para quien ya usa Kiritek.
- **Enforcement** — si cambia la decisión por defecto (p. ej. `warning → deny`).
  `sin cambio` significa que la decisión por defecto no se endurece.
- **Migración** — acción requerida al actualizar; `ninguna` si es transparente.

## [No publicado] — seguridad integral

Primera entrega de la seguridad integral del core, los adaptadores y los packs
de providers. Baseline en modo `warning` para no romper repos existentes; la
promoción a `enforce` es gobernada (`security doctor` / `security promote`).

| Cambio | Impacto | Enforcement | Migración |
| --- | --- | --- | --- |
| Core de secretos (Gitleaks fijado 8.18.4 + checksum) staged/push/repo/historial | Alto — nuevo gate de secretos | `warning` por defecto; `deny` tras promoción gobernada | Instalar/actualizar; revisar propuestas `*.kiritek-new`. Ver [`MIGRATION.md`](./MIGRATION.md) |
| Protección de archivos sensibles (`.env`, `*.key`, PEM, `credentials.json`, `secrets/`) | Alto | `warning` → `deny` según modo | ninguna adicional al baseline |
| Guardas Git (push directo a default bloqueado, `--force` denegado, `--no-verify` denegado) | Medio | `block-direct-push=true`, `force-policy=deny` por defecto | revisar flujo de ramas; usar feature branches |
| Resolución dinámica de rama default (nunca asume `main`) | Medio | sin cambio | definir `--default-branch` en enforcement/no interactivo si hay ambigüedad |
| Conventional Commits + sintaxis Jira local (commit-msg) | Medio | `warning` → `deny` según modo | ajustar mensajes al formato; `commits.enabled=false` para desactivar formato |
| Validación remota de claves Jira (pre-push/CI) | Medio (opcional) | `fail-closed` por defecto cuando Jira está habilitado | configurar `jira.baseUrl` y credenciales por entorno |
| Adaptador Claude Code (`PreToolUse`, fail-safe exit 2) | Medio | bloqueo por fail-safe ante error | instalar hooks en `.claude/` |
| Adaptador Kiro (`PreToolUse`, decide por exit code 0/2) | Medio | bloqueo (exit 2) ante error | instalar hooks por workspace |
| CI portable + workflow endurecido (sin push/commit, actions por SHA, permisos mínimos) | Alto para 0.1.0 | sin cambio en la decisión; corrige fuga de workflow | reemplaza/propone `kiritek-audit.yml`; artefacto personalizado deja `*.kiritek-new` |
| Auditoría por capacidades (`security audit [--deep]`) con exit 0/1/3 | Bajo | sin cambio | ninguna |
| Packs de providers GitHub y AWS CodeCommit (dry-run, nunca autoaplican) | Bajo (opcional) | sin cambio | `provider plan ...`; aplicar requiere confirmación humana |
| Redactor obligatorio (fail-closed) y evidencia caducable | Alto (transversal) | sin cambio | ninguna |

### Notas de enforcement

- El baseline **no** rompe repos existentes: entra en `warning`. El salto a
  `enforce` exige readiness (`security doctor`) y queda registrado
  (`security promote`), con override gobernado (actor + razón) sólo sobre
  readiness **no verificable**, nunca sobre una falla demostrada.
- Ningún cambio introduce —ni introducirá— un gate por "autoría IA". Ver
  [`SECURITY.md`](./SECURITY.md) §7.

### Notas de migración

- La migración desde 0.1.0 **adopta** los artefactos legacy con su hash actual y
  parchea el workflow inseguro; un artefacto personalizado nunca se sobrescribe.
  Detalle en [`MIGRATION.md`](./MIGRATION.md).
- Mientras exista un conflicto crítico sin resolver (p. ej. workflow inseguro
  personalizado), el estado se declara **no conforme** hasta resolverlo.
