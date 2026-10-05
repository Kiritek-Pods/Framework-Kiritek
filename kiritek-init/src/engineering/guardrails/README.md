# engineering/guardrails

Pack independiente de `core/security` para guardrails de ingeniería/producto.
Spec: `.kiro/specs/kiritek-engineering-guardrails/`.

| Directorio | Tarea | Contenido |
| --- | --- | --- |
| `contracts/` | T01 | Contratos versionados, envelope v2 y separación de dominios (ver su README). |
| `catalog/` | T02 | Catálogo versionado por digest: carga, verificación (digest/firma), cache segura, resolución fija, conformidad, diff y migraciones. |
| `config/` | T03 | `kiritek-engineering.config.json`: validación, precedencia con procedencia por hoja, locks organizacionales. |
| `workspace/` | T04–T05 | Unidades y perfiles efectivos (cierre `extends`), discovery sólo sugerente, identidad/aliases, ownership por globs, grafo de impacto (SCC) y alcance por momento (staged, rango PR, agent, release). |
| `pipeline/` + `orchestrator.js` | T06 | Flujo único collector → normalizer → applicability → evaluator → waiver/N-A → compuerta → privacidad → adapter. |
| `canonical.js` | — | JSON canónico y `sha256:<hex>`. |
| `errors.js` | — | `GuardrailsError` con `code`, `pointer` y `remediation`. |

## Catálogo

- Los catálogos viven en `catalogs/engineering/guardrails/<semver>/`
  (`catalog.json`, `parameters/*.schema.json`, `notes/`).
- `digest` = SHA-256 del JSON canónico de `{ catalog sin digest/firma, files:
  { ruta: sha256 } }`: cubre todos los archivos de la versión. Al editar un
  catálogo **no publicado** hay que recalcularlo con `computeCatalogDigest`
  (`catalog/verify.js`); un catálogo publicado no se edita, se versiona.
- `.gitattributes` marca `catalogs/**` como `-text` para que `autocrlf` no
  cambie los bytes.
- Resolución: versión exacta (sin `latest` ni rangos), sólo fuentes locales
  verificadas (builtin + cache), una snapshot por ejecución
  (`createCatalogSession`). Incompatibilidad, digest fijado distinto o
  conformidad fallida abortan antes de evaluar.
- Un control con `enforce` sólo resuelve si su suite figura en
  `approvedConformanceSuites`; por defecto ninguna (R27).

## Configuración

Precedencia (mayor → menor): flags allowlisted (`catalog`, `offline`,
`levels`) > `KIRITEK_ENGINEERING_{CATALOG,OFFLINE,LEVELS}` > unidad > repo
(`defaults.controls`) > organización verificada > defaults del catálogo.
Niveles por control admiten `<control>@<unidad>` para acotar a una unidad.
Organización `locked` ⇒ cualquier override distinto falla con
`CONFIG_CONFLICT`. El `mode` de security no se lee.

`configHash` cubre sólo lo que puede cambiar una decisión (no CPUs, memoria,
rutas de cache/evidencia ni telemetría), así que es estable entre hosts.

## Alcance (workspace)

- Perfiles: sólo `explicit`/`inherited` satisfacen un control; `suggested`
  (discovery) nunca. Discovery devuelve confianza `low`/`medium`, no sigue
  symlinks, no copia contenido de manifests.
- Ownership: `owns`/`excludes` con razón. Path sin dueño ⇒ `shared`
  (sharedPaths o archivo raíz) o `unowned` (diagnóstico `UNOWNED_PATH`).
- `shared` es ambiguo: `expand` evalúa todas las unidades con
  `coverage: "expanded"`; `require-explicit` falla con `SCOPE_AMBIGUOUS`.
- Dependientes transitivos por `dependsOn`; ciclos = un componente.
- PR: `merge-base(base, head)..head`. Historia faltante/shallow ⇒
  `SCOPE_RANGE_INCOMPLETE`; nunca alcance vacío.
- `partitionKey` separa cache/evidencia/waivers/N-A por unidad, control y
  versión, perfiles y digest de catálogo.

## Pipeline y compuerta de bloqueo (T06)

- `evaluateRun` produce un envelope por cada unidad × control (fuera de
  alcance ⇒ `not_evaluated`; sin implementación ⇒ `unavailable`).
- Collectors: contexto congelado sin nivel; timeout por presupuesto; fallo ⇒
  observación `unavailable`/`timeout` (sin propagar mensajes).
- Evaluators: puros, síncronos, ejecutados dos veces (no determinismo ⇒
  error operativo). La clase de evidencia de cada finding se recalcula desde
  las observaciones citadas; sólo los deterministas cuentan para bloquear.
- `blockingEligible` se deriva en el contrato (design §9.2) e incluye: momento
  dentro del contrato de enforcement y evidencia **completa** (cualquier
  observación parcial/timeout/inválida ⇒ nunca deny).
- Deny no elegible ⇒ `warn` (o `error` si es operativo) + `DENY_NOT_ELIGIBLE`
  + evento auditable. `outcome.policyDeny` y `outcome.operationalError` van
  separados.
- Antes de publicar, `assertPublishable` falla cerrado ante campos
  prohibidos, rutas absolutas o credenciales (`REDACTION_FAILED`).
