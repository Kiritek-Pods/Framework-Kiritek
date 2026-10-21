# Control `search.input-rate`

Verifica por **comportamiento** (no por librerías ni nombres) que un input de
búsqueda remota/costosa respeta cadencia, mínimo de caracteres, obsolescencia,
cancelación, deduplicación y propagación de errores (R9). Estado inicial del
catálogo 1.0.0: `off|warn` (sin enforcement).

## Qué declara el equipo

`parameters.behaviorContract` → JSON validado contra
`schemas/engineering/controls/search-input-rate.contract.schema.json`:

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

- `triggers: "local"` ⇒ `warn` hasta declarar un **N/A gobernado** con costo
  medido bajo el umbral (R9.9).
- `minCharsException` (motivo + test que la prueba) desactiva sólo la regla de
  mínimo.
- Stacks no-JS: `harness: { kind: "trace-command", command, args, traceFile }`
  y emitir la traza estándar
  (`schemas/engineering/controls/search-input-rate.trace.schema.json`).

## Adapter (`node-adapter`)

```js
exports.createSearchUnderTest = ({ clock, transport, onResults, onError }) => ({
  type(text) { /* el usuario escribió `text` */ },
  dispose() {},
});
```

- `clock.setTimeout/clearTimeout/now`: reloj **virtual**; usarlo siempre.
- `transport.search(text, { signal })`: búsqueda remota controlada por el harness.
- `onResults(text, results)`: llamar al hacer visible un resultado.
- `onError(text, error)`: llamar al mostrar un error (no para cancelaciones).

El harness corre en un proceso hijo aislado, dos veces: si las trazas difieren
el resultado es `conflict` (flaky), nunca deny. Las consultas son sintéticas y
en la traza sólo hay IDs opacos (`q1`, `k1`) y longitudes.

## Reglas

| Regla | Escenario | Falla si… |
|---|---|---|
| `cadence` | burst | dos búsquedas empiezan a menos de `windowMs` |
| `minimum` | todos | empieza una búsqueda con menos de `minChars` |
| `stale-order` | todos | una respuesta vieja reemplaza resultados más nuevos |
| `cancellation` | supersede | cancelación soportada y la solicitud obsoleta responde |
| `dedupe` | equivalent | dos búsquedas equivalentes en menos de `dedupeWindowMs` |
| `propagation` | error-propagation | un error no se muestra o una cancelación se muestra como error |

Sin contrato: señales estáticas (handler + red) ⇒ como máximo `warn` pidiendo
evidencia conductual (R9.7).
