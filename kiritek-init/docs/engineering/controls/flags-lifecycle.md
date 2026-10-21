# `flags.lifecycle`

Verifica que cada feature flag tenga **dueño, fecha de retiro y valor por
defecto seguro**, avisa de las **flags vencidas** y, si el equipo tiene su
propio cliente de flags, que este **use el default cuando el proveedor falla**
y que los cambios (kill switch) **lleguen a tiempo**. Perfil requerido:
`feature-flags`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.flagRegistry` → JSON (schema `flags-lifecycle.contract`):

```json
{
  "schemaVersion": 1,
  "control": "flags.lifecycle",
  "flags": [
    { "key": "new-checkout", "owner": "team-pay", "kind": "release", "createdAt": "2026-09-01T00:00:00Z", "removeBy": "2026-11-15T00:00:00Z", "defaultValue": false, "killSwitch": true },
    { "key": "admin-panel", "owner": "team-core", "kind": "permission", "createdAt": "2026-01-01T00:00:00Z", "defaultValue": false }
  ],
  "client": { "timeoutMs": 800, "refreshSeconds": 60 },
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/flags.adapter.js" }
}
```

Tipos: `release` y `experiment` son temporales (exigen `removeBy`); `ops` y
`permission` pueden ser permanentes. Sin `client` sólo se evalúa el registro
(útil si se usa un SDK de terceros sin wrapper propio). Parámetros:
`maxLifetimeDays` (90), `expiryWarningDays` (14), `maxClientTimeoutMs` (5000).

## Reglas del registro (deterministas)

| Regla | Cuándo |
|---|---|
| `flag-expired` | flag temporal con `removeBy` ya pasado |
| `remove-by-missing` | flag temporal sin `removeBy` |
| `flag-lifetime` | `removeBy − createdAt` > `maxLifetimeDays` |
| `unsafe-default` | flag `permission` con default distinto de `false` |
| `kill-switch-type` | kill switch no booleano |
| `contract-timeout` | `client.timeoutMs` > `maxClientTimeoutMs` |

Flags que vencen dentro de `expiryWarningDays` se informan en el resultado
sin ser incumplimiento. Una flag vencida a propósito se maneja con un waiver
con fecha.

## Adapter del cliente

```js
exports.createFlagClientUnderTest = ({ clock, provider, flags, client }) => ({
  evaluate(key) {}, // → valor (o Promise)
});
```

| Escenario | Qué se espera | Regla |
|---|---|---|
| provider-value | usa el valor del proveedor | `provider-value` |
| provider-down | el proveedor falla ⇒ default, sin lanzar | `fallback-default` |
| provider-timeout | el proveedor no responde ⇒ default dentro de `timeoutMs` | `timeout` |
| invalid-value | tipo incorrecto ⇒ default | `invalid-value` |
| unknown-flag | flag no registrada ⇒ apagada, sin lanzar | `unknown-flag` |
| propagation | un cambio se ve dentro de `refreshSeconds` | `propagation` |

Remediaciones: [remediation.md](../remediation.md#flagslifecycle-catálogo-200).
