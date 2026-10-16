# `api.pagination`

Verifica que los endpoints de listado estén **acotados** (tamaño por defecto y
máximo), que recorrer todas las páginas traiga **todo, sin duplicados ni
saltos y en orden**, que el **cursor sea estable** cuando llegan datos nuevos
y que parámetros inválidos respondan **4xx, no 500**. Perfil requerido:
`http-api`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.paginationContract` → JSON (schema `api-pagination.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.pagination",
  "collections": [{ "id": "orders", "path": "/orders", "mode": "cursor", "defaultPageSize": 20, "maxPageSize": 100 }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/pagination.adapter.js" }
}
```

Opcionales: `itemsField` (`items`), `cursorField` (`nextCursor`),
`limitParam` (`limit`), `cursorParam` (`cursor`), `offsetParam` (`offset`).
Parámetro `maxPageSizeLimit` (500).

## Adapter

`createApiUnderTest({ clock, deps })`; el repositorio del handler lee de
`deps.store.all()` (ítems sintéticos en el orden de la fuente).

## Matriz de comportamiento (por colección)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| default-size | sin parámetros ⇒ `defaultPageSize` ítems | `default-page-size` |
| max-size | `limit` enorme ⇒ recorta a `maxPageSize` o 4xx | `max-page-size` |
| walk | todas las páginas: completo, sin duplicados, en orden, final detectable | `complete`, `duplicates`, `order`, `end-detection` |
| bad-limit | `limit` negativo o no numérico ⇒ 4xx o valor por defecto, nunca 5xx | `invalid-limit` |
| stable-cursor (cursor) | ítems nuevos entre páginas ⇒ sin repetidos ni saltos | `stable-cursor` |
| invalid-cursor (cursor) | cursor basura ⇒ 400 | `invalid-cursor` |

Remediaciones: [remediation.md](../remediation.md#apipagination-catálogo-200).
