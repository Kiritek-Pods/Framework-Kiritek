# `net.resilient-requests`

Verifica que las llamadas a APIs tengan **timeout**, **reintentos sólo cuando
es seguro**, **espera creciente** y que **no dupliquen operaciones** (p. ej.
cobros) al reintentar. Perfil requerido: `network-client`. Disponible desde el
catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.clientContract` → JSON (schema `net-resilient-requests.contract`):

```json
{
  "schemaVersion": 1,
  "control": "net.resilient-requests",
  "operations": [
    { "id": "list-orders", "idempotent": true, "timeoutMs": 2000, "idempotencyKey": "none",
      "retry": { "maxAttempts": 3, "backoff": "exponential", "baseMs": 200, "maxDelayMs": 2000, "on": ["429", "5xx", "network", "timeout"] } },
    { "id": "create-payment", "idempotent": false, "timeoutMs": 5000, "idempotencyKey": "header",
      "retry": { "maxAttempts": 3, "backoff": "exponential", "baseMs": 300, "on": ["5xx", "network", "timeout"] } }
  ],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/client.adapter.js" }
}
```

Parámetros: `maxTimeoutMs` (30000) y `maxAttempts` (5). Una operación no
idempotente sin `Idempotency-Key` que declare reintentos ante `network` o
`timeout` es un contrato inseguro (`contract-unsafe-retry`).

## Adapter

```js
exports.createClientUnderTest = ({ clock, transport, random, operations }) => ({
  call(operationId) {}, // → Promise: resuelve si hubo éxito, rechaza si no
});
```

`transport.send({ operation, headers })` responde según el escenario (status,
error de red `ECONNRESET` o nunca). `random()` es fijo para que el jitter sea
determinista. La traza sólo lleva intentos y esperas: nunca payloads ni claves.

## Matriz de comportamiento (por operación)

| Escenario | Qué se espera | Regla |
|---|---|---|
| timeout | el servidor no responde ⇒ la llamada termina igual | `timeout` |
| client-error | 400 ⇒ un solo intento | `client-error-retry` |
| transient / network | 503 o error de red ⇒ reintenta hasta tener éxito | `transient-retry` |
| retry-limit | 503 siempre ⇒ exactamente `maxAttempts` intentos | `retry-limit` |
| backoff | esperas ≥ base, crecientes si es exponencial, acotadas por `maxDelayMs` | `backoff` |
| retry-after | 429 con `Retry-After` ⇒ espera al menos eso | `retry-after` |
| ambiguous (no idempotente) | error de red tras enviar ⇒ no reintenta, o reintenta con la misma clave | `idempotency` |

Remediaciones: [remediation.md](../remediation.md#netresilient-requests-catálogo-200).
