# `api.request-limits`

Verifica que un **cuerpo enorme** o una **dependencia lenta** no tumben el
servicio: el cuerpo que supera el límite se rechaza con **413** antes de
procesarlo (también sin `Content-Length`), y una request cuya dependencia no
responde se corta al vencer el **timeout** con 503/504/408 y **cancela** el
trabajo en curso. Perfil requerido: `http-api`. Disponible desde el catálogo
2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.limitsContract` → JSON (schema `api-request-limits.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.request-limits",
  "maxBodyBytes": 65536,
  "timeoutMs": 2000,
  "endpoints": [{ "id": "create-order", "method": "POST", "path": "/orders", "sampleBody": { "sku": "k-1", "qty": 1 } }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/limits.adapter.js" }
}
```

Parámetros `maxBodyBytesLimit` (10 MiB) y `maxTimeoutMsLimit` (30000): el
contrato no puede declarar límites mayores.

## Adapter

`createApiUnderTest({ clock, deps })`; el trabajo del handler (base o
servicio externo) pasa por `deps.work({ signal })`. El cuerpo llega
parseado y `headers["content-length"]` trae su tamaño, salvo en `chunked`.

## Matriz de comportamiento (por endpoint)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| within (con cuerpo) | cuerpo de la mitad del límite ⇒ 2xx | `false-rejection` |
| oversized (con cuerpo) | cuerpo del doble del límite ⇒ 413 sin llamar a `work` | `body-limit`, `body-limit-status`, `processed-oversized` |
| chunked (con cuerpo) | igual, sin `Content-Length` ⇒ 4xx sin llamar a `work` | `body-limit-unverified`, `processed-oversized` |
| slow | `work` no termina ⇒ respuesta antes de `timeoutMs` (+10 %) con 503/504/408 y `signal` abortado | `request-timeout`, `timeout-status`, `cancel-on-timeout` |
| fast | `work` termina a la mitad de `timeoutMs` ⇒ 2xx | `premature-timeout` |

Remediaciones: [remediation.md](../remediation.md#apirequest-limits-catálogo-200).
