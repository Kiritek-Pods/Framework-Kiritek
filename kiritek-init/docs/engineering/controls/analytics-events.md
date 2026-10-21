# `analytics.events`

Verifica que cada evento de analytics **siga su esquema** declarado, se envíe
**una sola vez**, **sin datos personales**, y que una falla del envío **no
rompa la app** ni duplique eventos al reintentar. Perfil requerido:
`analytics`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.trackingPlan` → JSON (schema `analytics-events.contract`):

```json
{
  "schemaVersion": 1,
  "control": "analytics.events",
  "events": [
    { "name": "checkout.completed", "properties": [
      { "name": "amount", "type": "number", "required": true },
      { "name": "currency", "type": "string", "required": true, "enum": ["CLP", "USD"] }
    ] }
  ],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/tracking.adapter.js" }
}
```

Una propiedad cuyo nombre sugiere un dato personal (`email`, `phone`,
`address`, `password`, `token`…) es un finding determinista
(`pii-property`); la lista se configura con `parameters.forbiddenProperties`.

## Adapter

```js
exports.createTrackerUnderTest = ({ clock, transport, plan, user }) => ({
  trigger(eventName) {}, // corre el flujo de la app que emite ese evento
  flush() {},
});
```

`user` es un perfil sintético con email, nombre y teléfono **canario**: si
alguno aparece en lo enviado, es una fuga. `transport.send(payload)` acepta un
evento, una lista o `{ events }`, y puede fallar.

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| schema#&lt;evento&gt; (por evento) | se emite una vez, con propiedades obligatorias, tipos y valores permitidos, sin extras | `emitted-once`, `schema`, `unplanned-properties` |
| no-pii | nada de lo enviado contiene datos del usuario | `pii-leak` |
| transport-down | con el envío caído la acción no falla; al reintentar no hay duplicados | `failure-isolation`, `duplicate-delivery` |

Remediaciones: [remediation.md](../remediation.md#analyticsevents-catálogo-200).
