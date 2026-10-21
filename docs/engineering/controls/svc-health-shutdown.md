# `svc.health-shutdown`

Verifica que el orquestador (Kubernetes, ECS, etc.) pueda confiar en el
servicio: **liveness** responde mientras el proceso funciona y **no depende de
la base**; **readiness** responde 503 si una dependencia declarada no
responde; y al **apagar** (SIGTERM) el servicio **termina lo que está en
curso**, deja de estar "ready", **rechaza lo nuevo** y termina dentro del
**tiempo de gracia**. Perfil requerido: `backend-service`. Disponible desde el
catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.healthContract` → JSON (schema `svc-health-shutdown.contract`):

```json
{
  "schemaVersion": 1,
  "control": "svc.health-shutdown",
  "livenessPath": "/livez",
  "readinessPath": "/readyz",
  "dependencies": ["db"],
  "work": { "method": "POST", "path": "/reports" },
  "shutdownGraceMs": 10000,
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/health.adapter.js" }
}
```

Parámetro `maxGraceMs` (30000).

## Adapter

```js
exports.createServiceUnderTest = ({ clock, deps }) => ({
  handle(req) {},  // deps.db.ping() para readiness; deps.work() es el trabajo lento de `work`
  shutdown() {},   // lo que el servidor hace al recibir SIGTERM
});
```

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| live / ready | 2xx con todo sano | `liveness`, `readiness` |
| not-ready@dependencia | dependencia caída ⇒ readiness 503 y liveness 2xx | `readiness-checks-deps`, `liveness-independent` |
| drain | trabajo en curso + SIGTERM ⇒ termina en 2xx, readiness deja de estar ok, lo nuevo recibe 503, el apagado resuelve | `drain-in-flight`, `not-ready-on-shutdown`, `reject-new-work`, `shutdown-completes` |
| grace-bound | trabajo que nunca termina ⇒ el apagado igual termina al vencer la gracia | `grace-period` |

Remediaciones: [remediation.md](../remediation.md#svchealth-shutdown-catálogo-200).
