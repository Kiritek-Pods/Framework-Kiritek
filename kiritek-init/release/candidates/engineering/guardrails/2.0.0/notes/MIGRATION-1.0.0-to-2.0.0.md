# Migración 1.0.0 → 2.0.0

El salto es major porque cambian `supportedLevels` y `enforcementContract`
(regla semver del catálogo). No requiere cambios en la configuración.

1. `kiritek-init guardrails update --to 2.0.0 --dry-run` muestra el plan.
2. `kiritek-init guardrails update --to 2.0.0` aplica con backup y
   verificación; los niveles actuales se conservan (`warn` sigue siendo `warn`).
3. Para bloquear un control en una unidad: `guardrails doctor --unit <id>
   --control <id>` y, si está listo, `guardrails promote ... --to enforce`.

Rollback: `guardrails update --to 1.0.0` restaura el catálogo anterior; un
control promovido debe volver antes a `warn` (`promote --to warn`), porque
1.0.0 no soporta `enforce` y el update lo bloquea con plan de recuperación.
