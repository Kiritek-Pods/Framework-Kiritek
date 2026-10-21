# `svc.metrics`

Verifica que el servicio **mida lo que importa para operarlo** (tráfico,
errores y latencia por ruta, las métricas RED) y que lo haga **sin romper el
sistema de métricas**: las rutas van como plantilla (`/users/:id`), no como
URL concreta, y ningún label lleva datos del usuario. Perfil requerido:
`backend-service`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.metricsContract` → JSON (schema `svc-metrics.contract`):

```json
{
  "schemaVersion": 1,
  "control": "svc.metrics",
  "names": { "requests": "http_requests_total", "duration": "http_request_duration_seconds" },
  "endpoints": [{ "id": "get-user", "method": "GET", "route": "/users/:id" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/metrics.adapter.js" }
}
```

Opcionales: `metricsPath` (`/metrics`) y `labels` (`route`, `method`,
`status`).

## Adapter

`createServiceUnderTest({ clock, deps })` con el registro real de métricas
(prom-client, Micrometer, OpenTelemetry con exporter Prometheus…). Los
endpoints llaman a `deps.dependency()`, que tarda 250 ms virtuales o falla.
La latencia debe medirse con el `clock` inyectado.

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| exposed | `metricsPath` en texto Prometheus, contador `counter` e histograma `histogram` | `metrics-endpoint` |
| counted@<ep> | 3 requests ⇒ el contador de esa ruta y método sube 3 | `request-count` |
| errors@<ep> | 2 requests que fallan ⇒ suben con status 5xx | `error-count` |
| latency@<ep> | `_count` sube 1, hay bucket `+Inf` y `_sum` sube ~0,25 s | `latency-histogram` |
| cardinality@<ep> | 5 ids distintos no crean series nuevas y ningún label lleva token o email | `high-cardinality`, `pii-in-labels` |

Remediaciones: [remediation.md](../remediation.md#svcmetrics-catálogo-200).
