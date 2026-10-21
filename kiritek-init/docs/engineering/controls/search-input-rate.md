# `search.input-rate`

Verifica **por comportamiento** que un input de búsqueda remota o costosa no
genera trabajo de más ni muestra resultados obsoletos. Perfil requerido:
`search`. Momentos: agent y pre-commit (sólo contrato), PR y release (harness).

## Declaración del equipo

`parameters.behaviorContract` → JSON (schema `search-input-rate.contract`):

```json
{
  "schemaVersion": 1,
  "control": "search.input-rate",
  "triggers": "remote",
  "cancellation": "supported",
  "equivalence": "trim-lowercase",
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/search.adapter.js" }
}
```

Parámetros: `minChars` (3), `cadence.{strategy,windowMs}` (equivalent, 250 ms),
`dedupeWindowMs` (500), `localCostThresholdMs`. Stacks no-JS:
`harness.kind: "trace-command"` emitiendo la traza estándar.

## Adapter

```js
exports.createSearchUnderTest = ({ clock, transport, onResults, onError }) => ({
  type(text) {},   // el usuario escribió `text`
  dispose() {},
});
```

Use siempre `clock` (reloj virtual) y `transport.search(text, { signal })`.
Llame `onResults` al mostrar resultados y `onError` al mostrar un error real.

## Matriz de comportamiento

| Escenario | Qué hace el harness | Regla si falla |
|---|---|---|
| `burst` | ráfaga de teclas más rápida que `windowMs` | `cadence` |
| `min-chars` | textos por debajo del mínimo | `minimum` |
| `supersede` | nueva consulta mientras la anterior está en vuelo | `cancellation` |
| `out-of-order` | la respuesta vieja llega después de la nueva | `stale-order` |
| `equivalent` | misma consulta con espacios/mayúsculas | `dedupe` |
| `error-propagation` | error real y cancelación | `propagation` |

| Estado | warn | enforce |
|---|---|---|
| todos los escenarios pasan | allow | allow |
| escenario determinista falla | warn | deny (PR/release) |
| sin contrato; sólo handler/llamada detectados | warn (heurística) | warn |
| timeout / flaky / conflicto | warn / error | error, nunca deny |
| `triggers: "local"` | warn hasta N/A gobernado | igual |
| contrato inválido | error | error |

## Casos límite

- Transporte sin cancelación (`cancellation: "unsupported"`): se exige
  supersesión (que la respuesta obsoleta no se muestre), no aborto.
- Excepción de mínimo (`minCharsException`): requiere motivo y test.
- Búsqueda local barata: N/A gobernado con la medición como `evidenceRef`.
- Las consultas son sintéticas; en la traza sólo hay ids opacos y longitudes.
