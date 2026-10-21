# `app.device-permissions`

Verifica que los permisos del dispositivo (cámara, ubicación, notificaciones…)
se pidan **cuando se usa la funcionalidad**, con una **explicación previa**, que
si el usuario dice que no la app **siga funcionando** (con alternativa si se
exige), que **no insista** y que, si el permiso está bloqueado, ofrezca **ir a
ajustes**. Perfil requerido: `device-permissions`. Disponible desde el catálogo
2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.permissionsContract` → JSON (schema `app-device-permissions.contract`):

```json
{
  "schemaVersion": 1,
  "control": "app.device-permissions",
  "permissions": [{ "id": "nearby-stores", "kind": "location", "fallback": "required" }],
  "harness": { "kind": "node-adapter", "adapter": "apps/mobile/test/permissions.adapter.js" }
}
```

## Adapter

```js
exports.createPermissionsUnderTest = ({ clock, platform, permissions }) => ({
  launch() {}, useFeature(permissionId) {},
  view() { return { screen, rationale, fallback, settingsLink }; },
});
```

`platform.status(kind)` y `platform.request(kind)` son sintéticos: el harness
decide si el usuario concede, niega o ya bloqueó.

## Matriz de comportamiento (por permiso)

| Escenario | Qué se espera | Regla |
|---|---|---|
| not-on-launch | abrir la app no pide el permiso | `ask-in-context` |
| rationale | la explicación está visible al momento de pedir | `rationale` |
| granted | concedido ⇒ la funcionalidad anda a la primera | `granted-flow` |
| denied | negado ⇒ la app sigue y ofrece la alternativa | `denied-keeps-working`, `denied-fallback` |
| no-reprompt | usar de nuevo tras negar no vuelve a pedir | `no-reprompt` |
| blocked | bloqueado ⇒ no pide; ofrece ir a ajustes | `settings-link` |

Remediaciones: [remediation.md](../remediation.md#appdevice-permissions-catálogo-200).
