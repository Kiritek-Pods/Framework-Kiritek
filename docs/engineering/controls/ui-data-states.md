# `ui.data-states`

Verifica que toda pantalla que carga datos muestre **carga, contenido, vacío y
error con reintento**, y que nunca quede en blanco ni colgada. Perfil
requerido: `data-views`. Disponible desde el catálogo 2.0.0, en `warn` por
defecto.

## Declaración del equipo

`parameters.statesContract` → JSON (schema `ui-data-states.contract`):

```json
{
  "schemaVersion": 1,
  "control": "ui.data-states",
  "screens": [{ "id": "orders", "timeoutMs": 8000, "emptyState": "required", "retry": "required" }],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/orders.adapter.js" }
}
```

`emptyState`/`retry` pueden ser `not-applicable` (p. ej. una pantalla que
nunca está vacía). Parámetros: `maxTimeoutMs` (30000 por defecto).

## Adapter

```js
exports.createScreenUnderTest = ({ clock, transport, screen }) => ({
  mount() {},        // monta la pantalla; carga con transport.load()
  view() { return { state, items, retry, busy }; },
  retry() {},        // acción "reintentar"
});
```

`state`: `loading | content | empty | error`. `busy`: la carga está anunciada
a tecnologías de asistencia. El transporte es sintético (ítems opacos); la
traza sólo lleva estados y conteos.

## Matriz de comportamiento (7 escenarios por pantalla)

| Escenario | Qué se espera | Regla si falla |
|---|---|---|
| loading | estado de carga anunciado y luego contenido | `loading-state`, `loading-announced` |
| content | contenido con todos los ítems | `content-state` |
| empty | estado vacío explícito | `empty-state` |
| error | estado de error con reintento | `error-state`, `retry-available` |
| retry | reintentar vuelve a cargar y muestra contenido | `retry` |
| timeout | sin respuesta en `timeoutMs` ⇒ error | `timeout` |
| single-request | una sola carga al montar | `duplicate-request` |

| Estado | warn | enforce |
|---|---|---|
| Todos los escenarios pasan | allow | allow |
| Escenario fallido o contrato inválido | warn | deny |
| Sin contrato (llamadas de red detectadas) | warn | warn |
| Sin harness o tests faltantes | warn | warn |
| Adapter que no monta, timeout del harness, escenario inestable | warn | nunca deny |

Remediaciones: [remediation.md](../remediation.md#uidata-states-catálogo-200).
