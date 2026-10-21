# `svc.dependency-failure`

Verifica qué hace el servicio cuando **una base de datos o un servicio externo
se cuelga o falla**: corta la espera en su **timeout**, responde un **503/504
controlado** (o una respuesta degradada si así se declaró) en vez de 500 o de
quedar colgado, y con fallas repetidas **deja de llamar** a la dependencia
(circuit breaker) hasta que se **recupera**. Perfil requerido:
`backend-service`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.dependencyContract` → JSON (schema `svc-dependency-failure.contract`):

```json
{
  "schemaVersion": 1,
  "control": "svc.dependency-failure",
  "endpoint": { "method": "GET", "path": "/catalog" },
  "dependencies": [{ "id": "db", "kind": "database", "timeoutMs": 1000, "circuitBreaker": "required", "degraded": "not-applicable" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/dependencies.adapter.js" }
}
```

Parámetro `maxTimeoutMs` (10000).

## Adapter

```js
exports.createServiceUnderTest = ({ clock, deps }) => ({
  handle(req) {}, // deps.db.call(), deps.<id>.call() reemplazan a las dependencias reales
});
```

## Matriz de comportamiento (por dependencia)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| healthy | todo sano ⇒ 2xx | `healthy-path` |
| hang | la dependencia no responde ⇒ respuesta dentro del timeout, 503/504 o degradada | `dependency-timeout`, `failure-response` |
| error | la dependencia falla ⇒ 503/504 o degradada, nunca 500 ni excepción | `failure-response` |
| breaker (si se exige) | 20 fallas seguidas ⇒ menos de 20 llamadas; al recuperarse vuelve a 2xx | `circuit-breaker`, `breaker-recovery` |

Remediaciones: [remediation.md](../remediation.md#svcdependency-failure-catálogo-200).
