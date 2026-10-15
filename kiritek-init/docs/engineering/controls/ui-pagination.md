# `ui.pagination`

Verifica que las listas largas **carguen por páginas**, sin **repetir ni
saltar** ítems, en **orden**, que indiquen el **fin de la lista** y que una
página que falla **no borre lo ya cargado**. Perfil requerido:
`paginated-lists`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.listsContract` → JSON (schema `ui-pagination.contract`):

```json
{
  "schemaVersion": 1,
  "control": "ui.pagination",
  "lists": [{ "id": "orders", "pageSize": 20, "mode": "cursor", "endState": "required" }],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/orders-list.adapter.js" }
}
```

`mode`: `cursor` u `offset`. Parámetro `maxPageSize` (200).

## Adapter

```js
exports.createListUnderTest = ({ clock, transport, list }) => ({
  mount() {}, loadMore() {},
  view() { return { items, end, loading, error }; }, // items: ids en orden
});
```

`transport.fetchPage({ cursor | offset, limit })` responde
`{ items, nextCursor, hasMore }` sobre un dataset sintético de
`pageSize × 2 + 3` ítems opacos.

## Matriz de comportamiento (por lista)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| first-page | una petición de `pageSize` ítems al montar | `first-page`, `page-size` |
| all-pages | todos los ítems, sin duplicados, en orden, con fin visible y sin pedir de más (se tolera una página vacía extra) | `complete`, `duplicates`, `order`, `end-state`, `extra-requests` |
| load-after-end | después del fin no se pide nada | `load-after-end` |
| concurrent-load | dos "cargar más" seguidos ⇒ una petición en vuelo | `concurrent-load` |
| page-error | la página falla: se conserva lo cargado, se muestra el error y reintentar la recupera | `keep-on-error`, `error-state`, `retry` |
| shifting (cursor) | llegan ítems nuevos arriba: no se repite ni se salta nada | `stable-cursor` |

Remediaciones: [remediation.md](../remediation.md#uipagination-catálogo-200).
