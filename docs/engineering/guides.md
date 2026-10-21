# Guías

Todos los comandos son `kiritek-init guardrails …`, no interactivos, con JSON
estable en stdout y diagnóstico en stderr. Exit: 0 allow/warn · 1 deny
elegible · 2 uso · 3 config/catálogo · 4 herramienta no disponible · 5 error
interno · 6 conflicto/rollback de lifecycle.

## Repo nuevo

1. `install --surfaces=git,ci` (agrega `kiro`/`claude` si el equipo los usa).
2. Declare unidades y perfiles en `kiritek-engineering.config.json`; todos los
   controles quedan en `warn`.
3. Para cada control aplicable, agregue su contrato/manifest y el adapter del
   harness (ver [controls/](controls/)).
4. `scan --moment=pr --base=<sha> --revision=<sha>` y `audit` para ver qué
   quedó `verified`.

## Repo existente

1. `install --dry-run` muestra qué se crea. Una config engineering ya
   existente se respeta tal cual; un artefacto Kiritek personalizado no se
   pisa (se deja propuesta `.kiritek-new` y exit 6).
2. Hooks Git previos se preservan y encadenan. Con Husky, Lefthook,
   pre-commit, CaptainHook, `core.hooksPath` propio o el hook de
   `core/security`, la integración es manual: agregue la línea que devuelve
   `install` (`snippet`) y verifique con `audit` (superficie `git-pre-commit`).
3. Si hubo una instalación previa sin inventario, `migrate` la adopta.

## Monorepo

- Una unidad por app/paquete con `owns` disjuntos cuando sea posible;
  `dependsOn` para dependencias y `workspace.sharedPaths` para lo compartido.
- Un archivo compartido sin owner explícito amplía la evaluación a todas las
  unidades (o exige alcance explícito con `onAmbiguousImpact:
  "require-explicit"`): nunca se omiten unidades en silencio.
- `release` siempre se ejecuta por unidad (`--unit`), incluyendo sus
  dependencias de artefacto.

## Offline

`--offline` (o `execution.offline: true`) usa sólo catálogo, plugins y
evidencia verificados localmente. Los collectors sin red siguen funcionando;
lo que necesitaría red queda `unavailable` con diagnóstico, nunca como
cumplimiento ni como deny.

## CI / PR

La plantilla `.github/workflows/kiritek-engineering.yml` (`install --surfaces=ci`)
sólo invoca el CLI: el rango completo exige `fetch-depth: 0`; un checkout
shallow sin la base es `SCOPE_RANGE_INCOMPLETE` (error operativo, nunca deny).
No requiere secretos (funciona en forks). Para otros proveedores:

```sh
kiritek-init guardrails scan --moment=pr --base="$BASE_SHA" --revision="$HEAD_SHA" --offline --format=json > engineering.json
```

El JSON trae `annotations` neutrales (archivo, nivel, regla) para comentar el PR.
Release: `scan --moment=release --unit=<id> --revision=<sha> --artifact=<ref>`.

## Agentes (Kiro / Claude)

`install --surfaces=kiro,claude`. En el momento `agent` sólo se validan
contratos y manifests (los tests conductuales corren en PR); escrituras
parciales que dejan un artefacto incompleto nunca bloquean. Kiro: exit 0 con
feedback, exit 2 sólo con deny elegible. Claude: `allow` o `ask`
(`--warn-as=ask`), `deny` sólo si el core lo emite. Bash, shell y MCP no se
interceptan: los cubren pre-commit y PR (ver `audit`, `notInterceptable`).

## Rollout y promoción

1. Empiece en `warn` y observe: `audit`, `scan` en PR y feedback de calidad
   (`feedback --verdict=confirmed|false-positive`).
2. `doctor --unit=<u> --control=<c>` lista lo que falta: contrato de enforcement
   cuya suite R27 coincide con la registrada del control, está aprobada y pasa
   ahora (`conformance --control=<c>`), evidencia `verified` en PR y release,
   superficie CI, presupuesto, integridad del pack, sin waivers inválidos y
   falsos positivos ≤ 5 %.
3. `promote --unit=<u> --control=<c> --to=enforce [--dry-run] [--actor=<quién>]`
   cambia sólo ese par y agrega una línea a `.kiritek/engineering/promotions.jsonl`
   (actor, origen cli/ci, fecha, hash de config antes/después, evidencia y
   readiness) para revisarlo por PR. El tiempo transcurrido nunca promueve.

## Rollback

`promote --unit=<u> --control=<c> --to=warn` siempre está permitido, conserva
parámetros y evidencia, y también queda en `promotions.jsonl`. Para deshacer un `update`, restaure el backup que
indica `backupRef` o vuelva a `update --to=<versión anterior>` (si la config
no resuelve con esa versión, el downgrade se bloquea con plan de recuperación).

## Update

`update --dry-run [--to=<catálogo>]` muestra diff de catálogo, gates nuevos
(quedan `off`), niveles que se mantienen fijados y artefactos/superficies a
reconciliar. Sin `--dry-run` aplica con backup, verifica (config, linkage,
self-checks) y, si algo falla, restaura y verifica la restauración (exit 6).
Contenido personalizado detiene la operación sin cambios.

## Uninstall

`uninstall` retira sólo artefactos y wiring engineering, restaura el hook Git
previo y conserva security, waivers/N-A, evidencia, telemetría y backups.
`--purge-evidence` elimina además evidencia, telemetría, cache y backups
engineering (nunca waivers/N-A ni nada de security).
