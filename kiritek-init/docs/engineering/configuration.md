# Configuración

Archivo `kiritek-engineering.config.json` en la raíz del repo (la plantilla la
crea `guardrails install`; si ya existe una tuya, nunca se sobrescribe).

```json
{
  "schemaVersion": 1,
  "pack": { "id": "engineering/guardrails", "catalog": "1.0.0" },
  "workspace": {
    "units": [
      {
        "id": "acme/web",
        "root": "apps/web",
        "kind": "application",
        "profiles": [{ "id": "web", "version": "1.0.0" }, { "id": "search", "version": "1.0.0" }],
        "owns": ["apps/web/**"],
        "controls": {
          "search.input-rate": { "level": "warn", "parameters": { "behaviorContract": "apps/web/search.contract.json" } }
        }
      }
    ]
  },
  "defaults": { "controls": { "web.module-announcement": { "level": "warn" } } },
  "execution": { "budgetsMs": { "agent": 1500, "pre-commit": 5000, "pr": 600000, "release": 900000 }, "offline": false },
  "evidence": { "directory": ".kiritek/evidence/engineering", "retentionDays": 30 },
  "exceptions": { "waiverFiles": [".kiritek/engineering/waivers/*.json"], "notApplicableFiles": [".kiritek/engineering/not-applicable/*.json"], "maxWaiverDays": 90, "maxNaReviewDays": 365 },
  "telemetry": { "enabled": false },
  "plugins": []
}
```

## Precedencia

flags de CLI > variables `KIRITEK_ENGINEERING_{CATALOG,OFFLINE,LEVELS}` >
unidad > repo (`defaults`) > política organizacional verificada (lo bloqueado
por la organización no se puede relajar: `CONFIG_CONFLICT`) > defaults del
catálogo. `guardrails validate` incluye la procedencia de cada valor.
Las variables `KIRITEK_ENGINEERING_*` nunca aceptan credenciales.

## Catálogo

Versión **exacta** (sin `latest` ni rangos), verificada por digest e inmutable.
Major cambia contratos/enforcement; minor puede añadir controles (que `update`
deja en `off`); patch no cambia semántica. `guardrails catalog diff --to=<v>`
muestra el impacto antes de actualizar.

## Perfiles y unidades

Perfiles builtin: `web`, `mobile-app`, `search`, `module-launch` (y
personalizados namespaceados `<ns>/<nombre>` vía plugins). Un control sólo
aplica si la unidad **declara** los perfiles que exige; discovery sólo sugiere.
En monorepos cada unidad declara `owns`/`excludes`, `dependsOn` y, si hace
falta, `workspace.sharedPaths`: un cambio compartido amplía el alcance a las
unidades dependientes (nunca las omite en silencio).

## Controles y niveles

| Control | Perfiles | Momentos | Parámetro principal |
|---|---|---|---|
| [`search.input-rate`](controls/search-input-rate.md) | `search` | agent, pre-commit, pr, release | `behaviorContract` |
| [`app.minimum-supported-version`](controls/app-minimum-supported-version.md) | `mobile-app` | pre-commit, pr, release | `policyContract` |
| [`web.module-announcement`](controls/web-module-announcement.md) | `web` + `module-launch` | agent, pre-commit, pr, release | `launchManifest` |

Niveles: `off` (no evalúa; no es "conforme"), `warn` (avisa), `enforce` (puede
bloquear sólo lo determinista elegible). `enforce` exige que el catálogo lo
soporte y un contrato de enforcement con suite aprobada; si no, la config se
rechaza (nunca se degrada en silencio). Se llega a `enforce` con `promote`.

## Waivers y N/A gobernado

Un archivo JSON por registro (schemas `waiver` y `governed-na`):

- **Waiver**: deuda conocida y temporal sobre un finding (`target.fingerprint`)
  o una regla (`target.ruleId`), con alcance (`scope.paths` dentro de la unidad
  o `scopeHash`), owner, razón, ticket, aprobador distinto del owner, creación
  y expiración (≤ `maxWaiverDays`). El resultado queda `warn` con deuda
  (`SUPPRESSED_DEBT`), nunca `allow` limpio.
- **N/A gobernado**: no aplicabilidad funcional con prueba (`evidenceRef`, un
  archivo del repo), owner, razón y `reviewAt` (≤ `maxNaReviewDays`);
  criticidad `high` exige aprobador.

Se reactivan solos al expirar, al salir el cambio de su alcance o al cambiar
la versión del control. El reporte muestra deuda y próximo vencimiento sin
razones ni personas.

## Telemetría

Off por defecto. `telemetry.enabled: true` registra eventos locales
minimizados; el envío remoto exige además `endpoint` https y el token en
`KIRITEK_ENG_TELEMETRY_TOKEN`. Ver `src/engineering/guardrails/telemetry/README.md`.

## Plugins

```json
"plugins": [{ "id": "acme/payments-guardrails", "version": "1.0.0", "digest": "sha256:…" }]
```

Vendorizados en `.kiritek/plugins/`, verificados por digest/checksums, con
permisos mínimos y ejecutados aislados (Node ≥ 22). Ver
`src/engineering/guardrails/plugins/README.md`.
