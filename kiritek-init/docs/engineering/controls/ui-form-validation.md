# `ui.form-validation`

Verifica que los formularios **validen** sus campos, muestren **errores
accesibles** y **no pierdan lo escrito**. Perfil requerido: `forms`.
Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.formsContract` → JSON (schema `ui-form-validation.contract`):

```json
{
  "schemaVersion": 1,
  "control": "ui.form-validation",
  "forms": [{
    "id": "signup",
    "fields": [
      { "name": "email", "required": true, "format": "email" },
      { "name": "name", "required": true, "format": "text", "minLength": 2, "maxLength": 40 }
    ]
  }],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/signup.adapter.js" }
}
```

Formatos: `text`, `email`, `number`, `url`, `phone`. `minLength`/`maxLength`
aplican a `text`.

## Adapter

```js
exports.createFormUnderTest = ({ clock, form, submit }) => ({
  fill(name, value) {}, blur(name) {}, submit() {},
  view() { return { fields: [{ name, value, invalid, error, errorLinked }], focus, status, announced }; },
});
```

`errorLinked`: el mensaje está asociado al campo (`aria-describedby` o
equivalente). `submit(values)` es el envío sintético (puede fallar). Los
valores son sintéticos y **nunca** salen en la traza.

## Matriz de comportamiento (hasta 6 escenarios por formulario)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| required | enviar vacío no envía; obligatorios marcados, errores asociados, foco al primero, mensaje legible | `blocks-invalid-submit`, `required`, `error-linked`, `focus-first-invalid`, `message-text` |
| format | formato/largo inválido no envía; sin errores falsos | `format`, `false-error` |
| valid-submit | con datos válidos se envía una vez con esos valores | `submit` |
| double-submit | varios clics durante el envío ⇒ un solo envío | `double-submit` |
| server-error | el envío falla: se conserva lo escrito, se anuncia el error y se puede reenviar | `preserve-input`, `error-announced`, `resubmit` |
| error-clears | corregir un campo quita su error | `error-clears` |

Mismos estados que el resto de los controles: sólo un escenario determinista
fallido (o un contrato inválido) puede bloquear, y sólo en `enforce`.

Remediaciones: [remediation.md](../remediation.md#uiform-validation-catálogo-200).
