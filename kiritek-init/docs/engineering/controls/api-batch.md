# `api.batch`

Verifica que un endpoint de lote **diga qué pasó con cada ítem**: un lote
válido se aplica entero con un resultado por ítem, en orden; si un ítem es
inválido o falla al guardarse, en modo `partial` los demás se aplican y el
malo se informa, y en modo `atomic` **no queda ninguno aplicado**. Además un
lote por encima del tope se rechaza sin aplicar nada y un lote vacío nunca da
5xx. Perfil requerido: `http-api`. Disponible desde el catálogo 2.0.0, en
`warn` por defecto.

## Declaración del equipo

`parameters.batchContract` → JSON (schema `api-batch.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.batch",
  "endpoints": [{
    "id": "orders", "path": "/orders/batch", "mode": "partial", "maxItems": 50,
    "sampleItem": { "sku": "k-1", "qty": 1 },
    "invalidItem": { "sku": "", "qty": -1 }
  }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/batch.adapter.js" }
}
```

Opcionales: `method` (`POST`), `itemsField` (`items`), `resultsField`
(`results`) y `refField` (`ref`, la referencia que cada resultado repite).
Un resultado cuenta como fallido si trae `error`, `ok: false` o un `status`
que no es 2xx. Parámetro `maxBatchItemsLimit` (1000).

## Adapter

`createApiUnderTest({ clock, deps })`; el repositorio escribe con
`deps.store.save(item)` o `deps.store.transaction(async (tx) => tx.save(item))`
(todo o nada). En `apply-failure` guardar el ítem `k-2` falla.

## Matriz de comportamiento (por endpoint)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| all-ok | 2xx, tres resultados en orden con su ref y los tres guardados | `batch-results`, `batch-not-applied` |
| invalid-item / apply-failure | partial: el ítem malo informado y los otros dos guardados. atomic: error y nada guardado | `silent-failure`, `partial-lost`, `not-atomic` |
| over-limit | `maxItems + 1` ⇒ 4xx y nada guardado | `batch-limit` |
| empty | lote vacío ⇒ nunca 5xx | `empty-batch` |

Remediaciones: [remediation.md](../remediation.md#apibatch-catálogo-200).
