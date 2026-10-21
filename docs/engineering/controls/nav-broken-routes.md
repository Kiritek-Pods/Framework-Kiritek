# `nav.broken-routes`

Verifica que una **ruta inexistente** muestre una página clara **con salida**,
que una **URL mal formada** no rompa la app y que un **enlace a una ruta
protegida** lleve al login y **vuelva a su destino** (con sus parámetros)
después. Perfil requerido: `routed-app`. Disponible desde el catálogo 2.0.0, en
`warn` por defecto.

## Declaración del equipo

`parameters.routesContract` → JSON (schema `nav-broken-routes.contract`):

```json
{
  "schemaVersion": 1,
  "control": "nav.broken-routes",
  "routes": [{ "path": "/", "auth": false }, { "path": "/orders/:id", "auth": true }],
  "deepLinks": "required",
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/router.adapter.js" }
}
```

## Adapter

```js
exports.createRouterUnderTest = ({ clock, session, routes }) => ({
  navigate(url) {}, login() {},
  view() { return { status, route, url, exitLink }; }, // status: ok | not-found | login | error
});
```

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| known | una ruta declarada abre su pantalla | `route-match` |
| unknown | ruta inexistente ⇒ "no encontrado" con salida | `not-found-page`, `exit-link` |
| malformed | URL mal codificada ⇒ no rompe | `malformed-url` |
| deep-auth | enlace protegido sin sesión ⇒ login ⇒ vuelve al destino con sus parámetros | `auth-redirect`, `return-after-login`, `keep-query` |

Remediaciones: [remediation.md](../remediation.md#navbroken-routes-catálogo-200).
