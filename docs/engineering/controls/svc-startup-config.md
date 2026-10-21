# `svc.startup-config`

Verifica que el servicio **falle al arrancar, no en producción**: con la
configuración válida arranca; si falta una variable obligatoria o tiene un
formato inválido se niega a arrancar (fail fast) con un error que **nombra
la variable**; las opcionales usan su valor por defecto, y ningún error
**muestra secretos**. Perfil requerido: `backend-service`. Disponible desde el
catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.startupConfigContract` → JSON (schema `svc-startup-config.contract`):

```json
{
  "schemaVersion": 1,
  "control": "svc.startup-config",
  "variables": [
    { "name": "DATABASE_URL", "kind": "url" },
    { "name": "API_TOKEN", "kind": "secret" },
    { "name": "PORT", "kind": "int", "required": false },
    { "name": "LOG_LEVEL", "kind": "enum", "required": false, "values": ["debug", "info", "warn", "error"] }
  ],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/config.adapter.js" }
}
```

`kind`: `string`, `url`, `int`, `enum` (con `values`), `bool` o `secret`.
`required` es `true` por defecto. `example` reemplaza el valor válido que usa
el harness (p. ej. una URL `postgres://`).

## Adapter

`startService({ env, logger, clock })` arranca el servicio real leyendo `env`
en vez de `process.env`. Arrancar es resolver; negarse es lanzar o rechazar
dentro de 5 s virtuales. Lo que se registre por `logger.write(line)` también
se revisa.

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| valid | todas válidas ⇒ arranca | `valid-config-rejected` |
| missing@<var> (obligatorias) | falta ⇒ no arranca y el error la nombra | `missing-not-detected`, `unhelpful-error` |
| invalid@<var> (url, int, enum, bool) | formato inválido ⇒ no arranca y el error la nombra | `invalid-not-detected`, `unhelpful-error` |
| optional@<var> (opcionales) | falta ⇒ arranca igual | `optional-required` |
| secrets (si hay secretos) | el error de arranque no contiene ningún secreto | `secret-in-config-error` |

Regla del contrato: `contract-enum-values` (enum sin `values`).

Remediaciones: [remediation.md](../remediation.md#svcstartup-config-catálogo-200).
