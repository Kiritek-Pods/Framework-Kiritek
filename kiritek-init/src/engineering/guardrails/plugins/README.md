# Plugins / control packs (T15B)

Extensiones con perfiles y controles propios bajo un **namespace**, sin forkear
el motor. Se vendorizan en el repo y se fijan en la config:

```json
"plugins": [{ "id": "acme/payments-guardrails", "version": "1.0.0", "digest": "sha256:…" }]
```

Ubicación: `.kiritek/plugins/<namespace>__<nombre>/<versión>/kiritek-plugin.json`
(schema `plugin-manifest`). Nunca se descargan ni instalan durante la evaluación.

## Verificación al resolver la config (`manifest.js`, `conformance.js`, `loader.js`)

Cualquier fallo rechaza la resolución (exit de configuración), de forma
determinista e independiente del orden de los pins:

| Código | Causa |
|---|---|
| `PLUGIN_NOT_FOUND` / `PLUGIN_PIN_MISMATCH` | no vendorizado o id/versión distintos del pin |
| `PLUGIN_MANIFEST_INVALID` | fuera de schema (p. ej. `scripts`), entry no verificado |
| `PLUGIN_DIGEST_MISMATCH` | digest (manifest + checksums) ≠ manifest ≠ pin |
| `PLUGIN_FILE_TAMPERED` | archivo alterado, extra, faltante o symlink |
| `PLUGIN_INCOMPATIBLE` | `engine.kiritekInit` no satisfecho |
| `PLUGIN_NAMESPACE_INVALID` | perfil/control/collector/evaluator fuera del namespace |
| `PLUGIN_CONFLICT` | namespace reclamado dos veces o pin duplicado |
| `PLUGIN_CONTROL_INVALID` | contrato de control (el mismo que los builtin), presupuestos, schema de parámetros |
| `PLUGIN_PERMISSIONS_EXCESSIVE` | lectura global/`.git`/`.kiritek`, hosts no exactos, env con credenciales, procesos |
| `PLUGIN_MUTABLE_EXECUTION` / `PLUGIN_UNPINNED_DEPENDENCY` | `curl\|sh`, scripts de instalación, dependencias no exactas |
| `PLUGIN_DATA_CONSENT_REQUIRED` | datos personales/contenido/telemetría sin `consentRef`; credenciales nunca |

`enforce` exige `enforcementContract` y suite `<suite>@<versión>` aprobada
localmente; si no, el nivel se retira (`PLUGIN_ENFORCE_NOT_APPROVED`) y la
config que pida `enforce` falla — nunca se degrada en silencio. Los controles y
perfiles se fusionan en la snapshot con un **digest compuesto** (catálogo +
plugins), así evidencia y cache quedan ligadas a la extensión exacta.

## Ejecución aislada (`runtime.js`, `plugin-runner.cjs`)

El código del plugin nunca corre en el proceso del motor. Collectors y
evaluator se ejecutan en procesos hijo con el **modelo de permisos de Node
(≥ 22)**: lectura sólo del plugin, del runner y de las rutas declaradas;
escritura sólo en un temporal privado; sin procesos hijo, workers ni bindings
nativos; red bloqueada salvo hosts declarados; entorno mínimo (sólo `envNames`
declarados); timeout. El plugin sólo puede requerir builtins de Node y
archivos relativos propios. Sin modelo de permisos fiable (Node < 22) el
plugin queda `unavailable`: nunca se ejecuta sin aislamiento.

Un fallo (excepción, crash, salida ilegible, timeout) queda en su control.
El evaluator no puede fijar `blockingEligible` ni campos de decisión del core
(`PLUGIN_FORBIDDEN_FIELD`): `mayDeny` lo recalcula siempre el core, y un deny
heurístico se degrada con `DENY_NOT_ELIGIBLE`.

### Interfaz del entry

```js
exports.collectors = { "<ns>/<collector>": { version, async collect(ctx) { return [observation] } } };
exports.evaluators = { "<ns>/<area>.<control>": { version, evaluate(practiceInput) { return { decision, reason?, findings? } } } };
```
