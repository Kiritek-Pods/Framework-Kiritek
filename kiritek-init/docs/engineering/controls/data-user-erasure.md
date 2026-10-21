# `data.user-erasure`

Verifica que **"borrar mi cuenta" borre todo**: después del pedido no queda
el id, email, teléfono ni nombre del usuario en ninguno de los almacenes
declarados (borrados o anonimizados), no se tocan los datos de otros
usuarios, lo borrado no reaparece en listados ni exportaciones, repetir el
pedido no da 5xx y un usuario inexistente no borra nada. Perfil requerido:
`backend-service`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.erasureContract` → JSON (schema `data-user-erasure.contract`):

```json
{
  "schemaVersion": 1,
  "control": "data.user-erasure",
  "erasure": { "method": "DELETE", "path": "/users/:userId" },
  "stores": [{ "id": "users" }, { "id": "orders" }, { "id": "events" }],
  "readEndpoints": [{ "id": "admin-list", "path": "/admin/users" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/erasure.adapter.js" }
}
```

`stores`: cada tabla, colección o servicio que guarda datos del usuario.
`readEndpoints`: listados o exportaciones donde lo borrado no debe aparecer
(`:userId` se reemplaza por el usuario borrado).

## Adapter

`createServiceUnderTest({ clock, deps })`; los repositorios usan
`deps.stores[<id>]` (`all`, `insert`, `update(pred, patch)`,
`remove(pred)`). Cada almacén arranca con dos filas del usuario que se borra
y dos de otro, con la forma `{ id, userId, email, phone, name }` y datos
canario. Si el borrado sigue en segundo plano (202), el harness espera 60 s
virtuales antes de revisar.

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| store@<id> | borrado 2xx y ningún rastro del usuario en ese almacén | `erasure-status`, `erasure-incomplete` |
| others | las filas del otro usuario quedan idénticas | `collateral-deletion` |
| reads (si hay `readEndpoints`) | ninguna lectura devuelve datos del usuario borrado | `erased-reappears` |
| repeat | repetir el borrado ⇒ 2xx o 404 | `erasure-not-idempotent` |
| unknown | usuario inexistente ⇒ sin 5xx y sin borrar nada | `erasure-unknown-user` |

Remediaciones: [remediation.md](../remediation.md#datauser-erasure-catálogo-200).
