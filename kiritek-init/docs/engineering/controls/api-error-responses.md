# `api.error-responses`

Verifica que la API **responda bien cuando algo sale mal**: entrada inválida ⇒
400/422; JSON roto ⇒ 400; ruta inexistente ⇒ 404; falla interna ⇒ 5xx
controlado. Todos los errores siguen el **mismo formato** y **ninguno expone
detalles internos** (stack traces, rutas del servidor, SQL, IPs internas).
Perfil requerido: `http-api`. Disponible desde el catálogo 2.0.0, en `warn` por
defecto.

## Declaración del equipo

`parameters.errorsContract` → JSON (schema `api-error-responses.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.error-responses",
  "errorFormat": "problem+json",
  "endpoints": [{ "id": "create-order", "method": "POST", "path": "/orders", "sampleBody": { "sku": "k-sku-1", "qty": 1 }, "invalidBodies": [{ "sku": 7 }, { "qty": -1 }] }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/errors.adapter.js" }
}
```

`errorFormat`: `problem+json` (RFC 9457) o `custom` con `errorFields` (los
campos que todo error debe traer, en la raíz o bajo `error`).

## Adapter

Mismo `createApiUnderTest({ clock, deps })` que el resto de los controles de
API. `deps.dependency()` reemplaza a la base o servicio: en el escenario de
falla interna lanza un error con detalles internos canario (stack, IP interna,
SQL). Si alguno llega a la respuesta, la fuga está comprobada.

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| invalid@endpoint | cada cuerpo inválido ⇒ 400/422 | `validation-status` |
| malformed@endpoint | JSON roto ⇒ 400 | `malformed-body` |
| not-found | ruta inexistente ⇒ 404 | `not-found-status` |
| internal@endpoint | dependencia que falla ⇒ 5xx | `internal-status` |
| todos | formato declarado; sin detalles internos (en cuerpo ni headers) | `error-format`, `no-internal-details` |

Remediaciones: [remediation.md](../remediation.md#apierror-responses-catálogo-200).
