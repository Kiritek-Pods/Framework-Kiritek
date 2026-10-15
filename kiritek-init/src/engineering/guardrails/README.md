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
| `runtime/` | T07 | `runTool` sin shell (cwd confinado, env allowlist, temporal propio, kill de árbol por timeout/memoria), presupuestos por momento, pool y cache de observaciones verificada. |
| `privacy/` | T08 | Publicación: minimización por schema → campos prohibidos → saneo → detector final → schema → escritura atómica; almacén de evidencia v2. |
| `controls/` | T10–T12 | Implementaciones de controles (`builtinControls()`): `search-input-rate/`, `app-minimum-supported-version/` y `web-module-announcement/`, cada uno con harness conductual. |
| `exceptions/` | T13 | Gobierno de waivers y N/A: schema, alcance no global, aprobación, expiraciones máximas, prueba de N/A y carga desde `exceptions.waiverFiles`/`notApplicableFiles`. |
| `adapters/` | T14 | Superficies agent (Kiro, Claude), Git pre-commit, CI/PR y release sobre el mismo core; cobertura declarada y enlace `install --surfaces`. |
| `audit/` | T15 | Auditoría por capacidades (unidad × control × momento), observación de superficies, registro de ejecuciones, self-checks sintéticos, readiness `doctor`/`promote` y reporte multidominio. |
| `telemetry/` | T15A | Telemetría minimizada opt-in: eventos locales, feedback de calidad, alertas agregadas y entrega remota con ack/idempotencia. |
| `plugins/` | T15B | Plugins/control packs vendorizados y fijados por digest: verificación (schema, checksums, namespace, motor, permisos, supply chain, consentimiento), fusión con digest compuesto y ejecución aislada (modelo de permisos de Node + guard de red). |
| `conformance/` | T16 | Suites R27 empaquetadas por control (casos positivos/negativos/borde con adapters de referencia, pipeline real, dos corridas), registro de suites y `approved.json` (cada aprobación fija el digest de la suite y sólo la escribe el gate de release, ver `docs/engineering/release.md`); `doctor` exige que la suite del contrato sea la registrada, esté aprobada y pase. |
| `install/` + `compatibility.js` | T09, T15C | Lifecycle transaccional (install/update/migrate con plan, backup, verificación y restauración verificada; uninstall con retención), wiring de superficies y matriz de compatibilidad. Documentación de usuario en `docs/engineering/`. |
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

## Runtime, cache y privacidad (T07–T08)

- Presupuesto total por momento (`execution.budgetsMs`): agotado ⇒ estado
  `timeout` con `BUDGET_EXHAUSTED` y el fallback del control; nunca deny.
- Cache de observaciones: clave con identidad completa (catálogo, control,
  collectors, unidad, perfiles, revisión, scope, entradas, config,
  plataforma, momento). Sólo conjuntos completos; cada lectura revalida
  checksum/identidad/expiración; hit no eleva confianza ni salta frescura;
  toda entrada pasa el detector de privacidad antes de escribirse.
- Publicación: si el detector encuentra credenciales, emails, tarjetas
  (Luhn), rutas absolutas residuales, campos prohibidos o canarios
  registrados ⇒ `REDACTION_FAILED` y no se escribe nada. URLs y rutas se
  sanean (sin credenciales/query; rutas relativas al repo).
- Evidencia: `writeEvidence`/`readEvidence` en
  `<evidence.directory>/<unidad>/<control>/<id>.json`; `expiresAt` =
  creación + `freshness.maxAgeSeconds`; frescura recalculada al leer.
- Límite conocido: un dato real dentro de `facts` con una clave neutra no es
  detectable por patrón; por eso `facts` no se publica nunca (sólo cache, que
  exige canarios/detector) y los contratos de control (T10–T12) exigen
  valores sintéticos/opacos.
