---
name: node-express-patterns
description: Use when writing or reviewing Node.js/Express backend code — routes, middleware, error handling, async control flow, project structure, and environment/config management. Not for React/frontend code (use react-patterns).
metadata:
  origin: Propio de Kiritek
---

# Node.js / Express Patterns

## Estructura de proyecto

```
src/
  routes/       # definición de endpoints, delega a controllers
  controllers/  # orquesta request -> service -> response, sin lógica de negocio
  services/     # lógica de negocio, agnóstica de HTTP
  repositories/ # acceso a datos (DB, APIs externas)
  middleware/   # auth, validación, error handling
  config/       # env vars centralizadas (nunca leer process.env fuera de aquí)
```

Regla no-negociable: controllers no acceden directo a la DB, services no conocen `req`/`res`.

## Async / control de errores

- **Nunca** `async` handler sin try/catch o wrapper — un reject no capturado cuelga el request o crashea el proceso según versión de Express.
- Express 5 propaga rejects de async handlers automáticamente; Express 4 **no** — usar wrapper (`express-async-handler` o helper propio) si el proyecto está en v4.
- Un solo middleware de error al final (`(err, req, res, next) => ...`), nunca manejar errores inline en cada ruta.
- Errores de negocio como clases custom (`class NotFoundError extends Error`) con `statusCode`, no strings ni objetos planos.

## Validación

- Validar body/query/params en middleware antes del controller (zod, joi, o express-validator) — el controller asume input ya válido.
- Nunca confiar en tipos de `req.body` sin validar (JSON parseado no garantiza shape).

## Configuración

- Variables de entorno leídas una sola vez al arrancar (`config/env.js`), con validación de que existan las requeridas — fallar rápido al boot, no en medio de un request.
- Nunca hardcodear secrets ni URLs de ambiente en el código.

## Seguridad básica

- `helmet` para headers HTTP seguros.
- Rate limiting en endpoints públicos/auth (`express-rate-limit`).
- CORS explícito por origen permitido, nunca `*` en producción.
- Sanitizar output en logs — nunca loggear passwords, tokens, o PII completa.

## Checklist antes de dar por terminado un endpoint

- [ ] Validación de input en middleware
- [ ] Errores de negocio con clase custom + status code correcto
- [ ] No hay `await` sin try/catch (o handler queda sin proteger en Express 4)
- [ ] Config leída de `config/`, no `process.env` disperso
- [ ] Test cubre al menos el happy path + un caso de error
