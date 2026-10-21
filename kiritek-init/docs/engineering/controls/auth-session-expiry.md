# `auth.session-expiry`

Verifica qué pasa cuando la **sesión expira**: la app renueva el token una
sola vez (aunque varios pedidos fallen a la vez), nunca entra en bucle y, si no
puede renovar, lleva al **login sin perder lo que el usuario estaba haciendo**.
Perfil requerido: `auth-session`. Disponible desde el catálogo 2.0.0, en `warn`
por defecto.

## Declaración del equipo

`parameters.sessionContract` → JSON (schema `auth-session-expiry.contract`):

```json
{
  "schemaVersion": 1,
  "control": "auth.session-expiry",
  "session": { "refresh": "token-refresh", "preserveWork": "required" },
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/session.adapter.js" }
}
```

`refresh`: `token-refresh` o `none` (un 401 lleva directo al login).
`preserveWork`: `required` o `not-applicable`. Parámetro `requireRefresh`
(false): si es true, el contrato debe declarar renovación.

## Adapter

```js
exports.createSessionUnderTest = ({ clock, transport, auth, session }) => ({
  request(op) {},      // pedido real de la app (usa auth.token())
  setDraft(text) {},   // simula trabajo en curso
  view() { return { screen, draft }; }, // screen: "app" | "login" | "error"
});
```

`transport.send({ op, token })` responde 401 si el token venció;
`auth.refresh()` entrega un token nuevo (o falla). Tokens y borrador son
sintéticos y nunca salen en la traza.

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| valid | pedido con token vigente, sin renovar | `authenticated-request` |
| expired-refresh | 401 ⇒ renueva y repite una vez | `refresh-retry` |
| concurrent | tres 401 a la vez ⇒ una sola renovación, todos se repiten | `single-refresh`, `refresh-retry` |
| refresh-fails | la renovación falla ⇒ login, sin más pedidos, borrador conservado | `login-redirect`, `no-loop`, `preserve-work` |
| repeated-401 | el token nuevo también da 401 ⇒ login, sin bucle | `login-redirect`, `no-loop`, `preserve-work` |
| no-refresh (sin renovación declarada) | 401 ⇒ login, borrador conservado | `login-redirect`, `no-loop`, `preserve-work` |

Remediaciones: [remediation.md](../remediation.md#authsession-expiry-catálogo-200).
