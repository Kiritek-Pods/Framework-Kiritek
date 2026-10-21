# `ui.destructive-actions`

Verifica que las acciones que **borran, cancelan o cobran** pidan
**confirmación** o permitan **deshacer**, que **cancelar no ejecute nada**, que
nunca se ejecuten **dos veces** y que el resultado (o el error) quede claro.
Perfil requerido: `destructive-actions`. Disponible desde el catálogo 2.0.0, en
`warn` por defecto.

## Declaración del equipo

`parameters.actionsContract` → JSON (schema `ui-destructive-actions.contract`):

```json
{
  "schemaVersion": 1,
  "control": "ui.destructive-actions",
  "actions": [
    { "id": "delete-account", "safeguard": "confirm" },
    { "id": "archive-note", "safeguard": "undo", "undoWindowMs": 5000 }
  ],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/actions.adapter.js" }
}
```

`safeguard`: `confirm`, `undo` o `confirm-and-undo`. Con deshacer,
`undoWindowMs` es obligatorio y debe ser ≥ `parameters.minUndoWindowMs` (3000).

## Adapter

```js
exports.createActionUnderTest = ({ clock, transport, action }) => ({
  request() {}, confirm() {}, dismiss() {}, undo() {},
  view() { return { dialog, status, message }; },
});
```

`transport.execute()` aplica la acción y `transport.revert()` la revierte. Se
mide el **efecto neto**: deshacer puede demorar la ejecución hasta que vence la
ventana o ejecutar y revertir.

## Matriz de comportamiento (por acción)

| Escenario | Qué se espera | Regla |
|---|---|---|
| confirm-required | el primer clic sólo abre la confirmación | `confirmation` |
| dismiss | cancelar no ejecuta nada | `dismiss` |
| execute | confirmada (o vencida la ventana) se aplica una vez, con mensaje legible | `execute`, `message-text` |
| double-execute | clics repetidos ⇒ una sola ejecución | `double-execution` |
| undo | deshacer dentro de la ventana deja todo como estaba | `undo` |
| undo-expired | pasada la ventana queda aplicada | `undo-window` |
| failure | un error se muestra como error, nunca como éxito | `error-state`, `message-text` |

Remediaciones: [remediation.md](../remediation.md#uidestructive-actions-catálogo-200).
