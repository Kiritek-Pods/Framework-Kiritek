# `api.concurrency`

Verifica que dos personas (o dos procesos) que editan el mismo recurso **no se
pisen los cambios**: la API expone una versión (ETag o campo), aplica una
actualización con la versión vigente, **rechaza con 409/412** una versión
vieja, exige la versión en cada actualización y compara y guarda de forma
**atómica**. Perfil requerido: `http-api`. Disponible desde el catálogo 2.0.0,
en `warn` por defecto.

## Declaración del equipo

`parameters.concurrencyContract` → JSON (schema `api-concurrency.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.concurrency",
  "resources": [{ "id": "orders", "path": "/orders/:id", "mode": "etag" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/concurrency.adapter.js" }
}
```

`mode`: `etag` (header ETag, precondición en If-Match) o `version-field`
(versión en el cuerpo). Opcionales: `method` (`PATCH` o `PUT`, por defecto
`PATCH`), `versionField` (`version`), `field` (campo que el harness edita,
`name`) y `requirePrecondition` (`true`).

## Adapter

`createApiUnderTest({ clock, deps })`; el repositorio del handler usa
`deps.store` (asíncrono, con latencia virtual): `get(id)`, `save(record)` y
`saveIfVersion(record, expectedVersion)` (compare-and-set atómico, como un
`UPDATE … WHERE version = ?`).

## Matriz de comportamiento (por recurso)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| exposed | GET 2xx con la versión | `version-exposed` |
| conditional | actualizar con la versión vigente ⇒ 2xx y la versión cambia | `conditional-update`, `version-advances` |
| stale | otro guardó antes ⇒ 409/412 y su cambio sigue ahí | `stale-rejected`, `lost-update` |
| precondition | actualizar sin versión ⇒ 4xx sin guardar (si `requirePrecondition`) | `precondition-required` |
| race | dos actualizaciones simultáneas con la misma versión ⇒ gana una, la otra 409/412 | `atomic-check` |

Remediaciones: [remediation.md](../remediation.md#apiconcurrency-catálogo-200).
