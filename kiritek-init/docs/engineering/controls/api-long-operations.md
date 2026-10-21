# `api.long-operations`

Verifica que una operación pesada (un reporte, una importación) **no haga
esperar al cliente** y **siempre informe cómo terminó**: responde 202 enseguida
con la URL de estado en `Location`, el estado llega al valor final cuando el
trabajo termina, una falla se informa como fallida **sin exponer detalles
internos**, una operación colgada se marca fallida al vencer su duración
máxima y **cancela** el trabajo, y una operación inexistente da 404. Perfil
requerido: `http-api`. Disponible desde el catálogo 2.0.0, en `warn` por
defecto.

## Declaración del equipo

`parameters.operationsContract` → JSON (schema `api-long-operations.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.long-operations",
  "operations": [{ "id": "report", "path": "/reports", "statusPath": "/operations/:id", "sampleBody": { "month": "2026-05" }, "maxDurationMs": 60000 }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/operations.adapter.js" }
}
```

Opcionales: `method` (`POST`), `statusField` (`status`), `doneValue`
(`succeeded`) y `failedValue` (`failed`). Parámetro `maxDurationLimitMs`
(3600000).

## Adapter

`createApiUnderTest({ clock, deps })`; el trabajo pesado pasa por
`deps.work({ input, signal })`. El harness lo hace terminar a los 3 s
virtuales, fallar con un error interno canario o colgarse hasta que se aborte
su `signal`, y consulta el estado cada segundo virtual.

## Matriz de comportamiento (por operación)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| accepted | 202 en menos de 500 ms con `Location` | `not-async`, `status-location` |
| completes | el estado llega a `doneValue` | `never-completes` |
| fails | el estado llega a `failedValue`, sin stack ni rutas internas | `failure-not-reported`, `failure-leak` |
| stuck | `failedValue` al vencer `maxDurationMs` (+10 %) y `signal` abortado | `stuck-forever`, `not-cancelled` |
| unknown | estado de una operación inexistente ⇒ 404 | `unknown-operation` |

Remediaciones: [remediation.md](../remediation.md#apilong-operations-catálogo-200).
