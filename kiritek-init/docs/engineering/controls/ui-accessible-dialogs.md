# `ui.accessible-dialogs`

Verifica que modales, menús y paneles laterales sean **usables con teclado y
lector de pantalla**: el foco entra al abrir, **queda dentro** (modales y
paneles), **Escape** y clic afuera cierran lo que es descartable, el foco
**vuelve al botón de origen**, el rol y el nombre son correctos y el **fondo
queda inactivo**. Perfil requerido: `dialogs`. Disponible desde el catálogo
2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.dialogsContract` → JSON (schema `ui-accessible-dialogs.contract`):

```json
{
  "schemaVersion": 1,
  "control": "ui.accessible-dialogs",
  "dialogs": [
    { "id": "confirm-delete", "kind": "modal", "dismissible": false },
    { "id": "account-menu", "kind": "menu", "dismissible": true }
  ],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/dialogs.adapter.js" }
}
```

## Adapter

```js
exports.createDialogUnderTest = ({ dialog }) => ({
  open() {}, press(key) {}, clickOutside() {},
  view() { return { open, role, labelled, modal, focus, controls, backgroundInert }; },
});
```

`focus`: `"dialog"`, `"control:<id>"`, `"trigger"` o `"background:<id>"`.

## Matriz de comportamiento (por diálogo)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| focus-in | al abrir, el foco entra | `focus-in` |
| focus-trap (modal/panel) | Tab y Shift+Tab no salen | `focus-trap` |
| escape | descartable: cierra y devuelve el foco; no descartable: no cierra | `escape-close`, `focus-return` |
| outside-click | igual criterio que Escape | `outside-click` |
| semantics | rol correcto (`aria-modal` en modales) y nombre accesible | `role`, `accessible-name` |
| inert-background (modal/panel) | el fondo no se puede usar | `background-inert` |

Remediaciones: [remediation.md](../remediation.md#uiaccessible-dialogs-catálogo-200).
