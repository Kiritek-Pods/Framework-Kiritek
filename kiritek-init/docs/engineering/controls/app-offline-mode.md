# `app.offline-mode`

Verifica que sin conexión la app **avise**, **acepte y encole** las acciones
que deben funcionar offline, y que al volver la red las **sincronice una sola
vez y en orden**, incluso si la app se cerró en el medio. Las acciones que sólo
funcionan con red (p. ej. pagar) deben **rechazarse**, nunca darse por hechas.
Perfil requerido: `offline-capable`. Disponible desde el catálogo 2.0.0, en
`warn` por defecto.

## Declaración del equipo

`parameters.offlineContract` → JSON (schema `app-offline-mode.contract`):

```json
{
  "schemaVersion": 1,
  "control": "app.offline-mode",
  "indicator": "required",
  "actions": [
    { "id": "save-note", "queue": "required" },
    { "id": "pay", "queue": "online-only" }
  ],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/offline.adapter.js" }
}
```

## Adapter

```js
exports.createOfflineAppUnderTest = ({ clock, network, transport, storage, actions }) => ({
  perform(actionId, payload) {}, // → Promise; online-only sin red: rechaza o { ok: false }
  view() { return { offlineNotice, pending }; },
});
```

`network` lo controla el harness; `storage` sobrevive a "reiniciar" la app (el
harness crea una instancia nueva con el mismo almacenamiento).

## Matriz de comportamiento

| Escenario | Qué se espera | Reglas |
|---|---|---|
| notice | aviso sin red, sin aviso al volver | `offline-indicator` |
| online@acción | con red se envía una vez | `online-send` |
| queue@acción | sin red se acepta; al volver se envía una vez y la cola queda vacía | `offline-accept`, `sync-once`, `queue-drain` |
| restart@acción | la cola sobrevive a cerrar y abrir la app | `persist-queue` |
| order@acción | dos acciones offline se envían en orden | `sync-order` |
| offline-reject@acción (online-only) | sin red se rechaza y no se envía después | `online-only` |

Remediaciones: [remediation.md](../remediation.md#appoffline-mode-catálogo-200).
