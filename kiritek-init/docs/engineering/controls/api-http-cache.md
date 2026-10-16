# `api.http-cache`

Verifica que la API diga **explícitamente qué se puede cachear**: los recursos
públicos llevan el `max-age` declarado, los privados `private` o `no-store`
(nunca `public`, para que un proxy no se los muestre a otra persona), hay un
validador (ETag o Last-Modified), una petición condicional vigente recibe
**304 sin cuerpo**, el validador **cambia cuando cambia el recurso** y el ETag
de un recurso privado **no sirve para otro usuario**. Perfil requerido:
`http-api`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.cacheContract` → JSON (schema `api-http-cache.contract`):

```json
{
  "schemaVersion": 1,
  "control": "api.http-cache",
  "resources": [
    { "id": "product", "path": "/products/kp-1", "visibility": "public", "maxAgeSeconds": 300 },
    { "id": "cart", "path": "/me/cart", "visibility": "private" }
  ],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/cache.adapter.js" }
}
```

`validator`: `etag` (por defecto) o `last-modified`. `maxAgeSeconds` es
obligatorio en los públicos (si falta: `contract-max-age`). Parámetro `maxAgeLimitSeconds` (31536000).

## Adapter

`createApiUnderTest({ clock, deps })`; el handler lee de
`deps.store.read(user)` (`null` en públicos) y obtiene el usuario con
`deps.auth.userOf(headers)` (`Authorization: Bearer <usuario>`).

## Matriz de comportamiento (por recurso)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| headers | Cache-Control presente; públicos con el `max-age` declarado; privados `private`/`no-store`, sin `public` ni `s-maxage` | `cache-control-missing`, `max-age`, `private-cacheable` |
| validator | ETag o Last-Modified según el contrato | `validator-missing` |
| not-modified | condicional vigente ⇒ 304 sin cuerpo | `conditional-get`, `not-modified-body` |
| changed | el recurso cambió ⇒ 200 con el validador viejo | `stale-validator` |
| per-user (privados con ETag) | otro usuario con el ETag ajeno ⇒ 200 | `cross-user-validator` |

Remediaciones: [remediation.md](../remediation.md#apihttp-cache-catálogo-200).
