---
name: node-testing
description: Use when writing or reviewing tests for Node.js/Express backends — unit tests, integration tests with Supertest, mocking, and test structure with Jest or Vitest.
metadata:
  origin: Propio de Kiritek
---

# Node.js Testing

## Pirámide

- **Unit**: services y funciones puras, sin DB ni red — mockear repositories.
- **Integration**: rutas completas vía Supertest contra una app Express real (no mockear Express), DB real o Testcontainers si el proyecto ya usa contenedores para otros stacks.
- **No mockear lo que no es tuyo** salvo servicios externos (APIs de terceros, colas) — mockear tu propia DB en integration tests defeats the purpose.

## Estructura

```
src/services/user.service.js
src/services/user.service.test.js      # unit, junto al código
test/integration/users.route.test.js   # integration, separado
```

## Supertest (integration)

```js
const request = require("supertest");
const app = require("../src/app");

test("POST /users crea usuario válido", async () => {
  const res = await request(app).post("/users").send({ email: "a@b.com" });
  expect(res.status).toBe(201);
});
```

- Importar la app (`app.js`), no arrancar el server (`server.listen`) en tests — evita puertos ocupados y tests lentos.
- Limpiar estado de DB entre tests (transacción rollback o `beforeEach` truncate), nunca depender de orden de ejecución.

## Mocking

- Mockear a nivel de módulo/dependencia inyectada, no monkey-patchear internals.
- Si un service tiene muchas dependencias mockeadas para testear una función simple, es señal de que el service necesita dividirse.

## Reglas

1. **No "tested/verified" sin output real de `npm test`** — mismo principio que `git-workflow`.
2. Un test roto por un refactor legítimo se actualiza, no se skipea (`.skip`) sin ticket que lo justifique.
3. Nombres de test describen comportamiento, no implementación (`"rechaza email inválido"`, no `"llama a validate()"`)
