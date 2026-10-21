# `api.versioning`

Verifica que una API pueda **cambiar sin romper a sus clientes**: cada
versión vigente o deprecada sigue respondiendo, las deprecadas **avisan**
(headers `Deprecation` y `Sunset` con la fecha de retiro), una versión
inexistente responde **4xx**, una retirada responde **410** y ninguna versión
publicada **pierde campos**. Perfil requerido: `http-api`. Disponible desde
el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.versioningContract` → JSON (schema `api-versioning.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.versioning",
  "scheme": "path",
  "versions": [
    { "id": "v1", "status": "deprecated", "sunset": "2027-01-31", "requiredFields": ["id", "total"] },
    { "id": "v2", "status": "supported", "requiredFields": ["id", "total", "currency"] }
  ],
  "endpoints": [{ "id": "orders", "path": "/orders" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/versioning.adapter.js" }
}
```

`scheme`: `path` (`/v1/orders`) o `header` (la versión va en `header`, por
defecto `api-version`). `status`: `supported`, `deprecated` o `retired`.
`requiredFields`: campos que esa versión garantiza (en el cuerpo o en el
primer ítem de la lista).

## Adapter

`createApiUnderTest({ clock, deps })` con el router real y todas sus
versiones montadas.

## Matriz de comportamiento (por endpoint)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| served | cada versión no retirada ⇒ 2xx | `version-served` |
| deprecation | deprecadas con `Deprecation` y `Sunset` de su fecha; vigentes sin `Deprecation` | `deprecation-header`, `sunset-header`, `false-deprecation` |
| unknown | versión inexistente ⇒ 4xx | `unknown-version` |
| retired (si hay retiradas) | ⇒ 410 o 404 | `retired-version` |
| compatible (si hay `requiredFields`) | la respuesta conserva los campos de su versión | `breaking-change` |

Reglas del contrato: `contract-versions` (ninguna versión vigente) y
`sunset-passed` (una deprecada con fecha de retiro vencida).

Remediaciones: [remediation.md](../remediation.md#apiversioning-catálogo-200).
