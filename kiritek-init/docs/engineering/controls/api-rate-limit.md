# `api.rate-limit`

Verifica que cada límite declarado **se cumpla**: dentro del límite no hay 429;
al superarlo, **429 con `Retry-After`**; el conteo es **por cliente** (clave,
IP o usuario) y la **ventana se reinicia**. Perfil requerido: `http-api`.
Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.rateLimitContract` → JSON (schema `api-rate-limit.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.rate-limit",
  "limits": [{ "id": "search", "method": "GET", "path": "/search", "limit": 60, "windowSeconds": 60, "by": "api-key" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/rate-limit.adapter.js" }
}
```

Límites de más de 1000 pedidos por ventana no se prueban (quedan sin
evidencia ⇒ `warn`).

## Adapter

`createApiUnderTest({ clock, deps })` con el limitador real; debe medir el
tiempo con `clock.now()`. Identidades sintéticas: `x-api-key: kclient-a|b`,
`ip: 203.0.113.10|20` o `authorization: Bearer kuser-a|b`.

## Matriz de comportamiento (por límite)

| Hecho | Qué se espera | Regla |
|---|---|---|
| underLimitOk | `limit` pedidos dentro de la ventana sin 429 | `under-limit` |
| limited | el pedido `limit + 1` recibe 429 | `limit-enforced` |
| retryAfterOk | `Retry-After` entre 1 y la ventana | `retry-after` |
| perClient | otro cliente no queda bloqueado | `per-client` |
| windowReset | pasada la ventana, el cliente vuelve a poder | `window-reset` |

Remediaciones: [remediation.md](../remediation.md#apirate-limit-catálogo-200).
