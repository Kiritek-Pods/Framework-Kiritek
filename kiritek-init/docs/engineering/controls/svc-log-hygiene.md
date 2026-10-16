# `svc.log-hygiene`

Verifica que los logs del servicio sean **estructurados** (una línea JSON por
evento), lleven un **id de correlación** por request (el que llega en el
header o uno generado) y **nunca contengan datos personales ni secretos**
(email, teléfono, tarjeta, tokens, cookies, contraseñas), tampoco en los
mensajes de error. Perfil requerido: `backend-service`. Disponible desde el
catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.logsContract` → JSON (schema `svc-log-hygiene.contract`):

```json
{
  "schemaVersion": 1,
  "control": "svc.log-hygiene",
  "correlationHeader": "x-request-id",
  "fields": { "level": "level", "message": "msg", "requestId": "requestId" },
  "endpoints": [{ "id": "create-user", "method": "POST", "path": "/users", "sampleBody": { "plan": "pro" } }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/logs.adapter.js" }
}
```

`fields` admite rutas con punto (p. ej. `log.level`).

## Adapter

```js
exports.createServiceUnderTest = ({ clock, deps, logger }) => ({
  handle(req) {}, // el logger del servicio escribe a logger.write(line); deps.dependency() falla en "error"
});
```

Las requests llevan email, teléfono, tarjeta, token, cookie y contraseña
**canario** en cuerpo, headers y query. La traza sólo dice si aparecieron.

## Matriz de comportamiento (por endpoint)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| structured | hay logs y cada línea es JSON con nivel y mensaje | `structured-logs` |
| correlation | con header: todas las líneas llevan ese id; sin header: un id generado y estable | `correlation-propagated`, `correlation-generated` |
| no-pii | ningún canario aparece en los logs | `pii-in-logs`, `secret-in-logs` |
| error | la falla de la dependencia queda como nivel error, sin datos ni secretos | `error-logged`, `pii-in-logs`, `secret-in-logs` |

Remediaciones: [remediation.md](../remediation.md#svclog-hygiene-catálogo-200).
