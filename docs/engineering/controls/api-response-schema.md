# `api.response-schema`

Verifica que la API **responda lo que documenta**: cada respuesta real de
éxito cumple el JSON Schema declarado (tipos, requeridos, enums, nulos) y no
trae **campos sin documentar**, que suelen ser datos internos filtrados. Si
se declara un `errorSchema`, un cuerpo inválido responde 4xx con ese formato.
Perfil requerido: `http-api`. Disponible desde el catálogo 2.0.0, en `warn`
por defecto.

## Declaración del equipo

`parameters.responseSchemaContract` → JSON (schema `api-response-schema.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.response-schema",
  "errorSchema": { "type": "object", "required": ["code", "message"], "properties": { "code": { "type": "string" }, "message": { "type": "string" } } },
  "endpoints": [{
    "id": "create-order", "method": "POST", "path": "/orders",
    "sampleBody": { "items": [{ "sku": "k-1", "qty": 2 }] },
    "invalidBody": { "items": [] },
    "responseSchema": { "type": "object", "required": ["id", "status"], "properties": { "id": { "type": "string" }, "status": { "type": "string", "enum": ["pending", "paid"] } } }
  }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/response-schema.adapter.js" }
}
```

`status`: código de éxito esperado (201 en POST, 200 en el resto). Los
schemas pueden salir del OpenAPI del equipo, con el **subconjunto
verificable**: `type`, `properties`, `required`, `additionalProperties`,
`items`, `enum`, `const`, `anyOf`, límites (`minimum`, `maxLength`,
`pattern`…) y `$ref` locales. Anotaciones como `format` o `description` se
aceptan y no se verifican. Otras palabras clave (`oneOf`, `allOf`, `if`,
`$ref` externos) harían pasar respuestas sin verificar:
`contract-schema-unsupported`.

## Adapter

`createApiUnderTest({ clock, deps })` con el handler real y sus datos de
prueba.

## Matriz de comportamiento (por endpoint)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| success | código declarado, cuerpo que cumple `responseSchema` y sin campos no declarados | `response-status`, `schema-mismatch`, `undeclared-field` |
| error (con `invalidBody` y `errorSchema`) | 4xx con cuerpo que cumple `errorSchema` | `error-status`, `error-schema` |

Remediaciones: [remediation.md](../remediation.md#apiresponse-schema-catálogo-200).
