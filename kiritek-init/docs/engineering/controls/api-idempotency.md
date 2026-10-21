# `api.idempotency`

Verifica que repetir un pedido que modifica datos (un reintento del cliente,
un doble clic, un timeout de red) **no ejecute el efecto dos veces**: con la
misma `Idempotency-Key`, la API devuelve la **misma respuesta**, también si los
dos pedidos llegan **a la vez**; la misma clave con **otro cuerpo** se rechaza.
Perfil requerido: `http-api`. Disponible desde el catálogo 2.0.0, en `warn` por
defecto.

## Declaración del equipo

`parameters.idempotencyContract` → JSON (schema `api-idempotency.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.idempotency",
  "endpoints": [{ "id": "create-order", "method": "POST", "path": "/orders", "keyHeader": "Idempotency-Key", "requireKey": true, "sampleBody": { "sku": "k-sku-1", "qty": 1 } }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/idempotency.adapter.js" }
}
```

`sampleBody` es un cuerpo sintético de prueba.

## Adapter

```js
exports.createApiUnderTest = ({ clock, deps }) => ({
  handle({ method, path, query, headers, body, ip }) {}, // → Promise<{ status, headers, body }>
});
```

El adapter conecta el handler HTTP real en proceso y llama a `deps.effect()`
donde ocurre el efecto real (insertar, cobrar…), en lugar de la dependencia
real. Se mide cuántas veces ocurrió.

## Matriz de comportamiento (por endpoint)

| Escenario | Qué se espera | Regla |
|---|---|---|
| replay | dos pedidos seguidos con la misma clave: un efecto, misma respuesta | `single-execution`, `replay-same-response` |
| concurrent | dos pedidos simultáneos con la misma clave: un efecto, sin 5xx | `concurrent-single-execution` |
| distinct-keys | claves distintas: dos efectos | `distinct-keys` |
| key-mismatch | misma clave con otro cuerpo: 409/422, sin efecto | `key-mismatch` |
| missing-key (si es obligatoria) | sin clave: 400/428, sin efecto | `key-required` |

Remediaciones: [remediation.md](../remediation.md#apiidempotency-catálogo-200).
