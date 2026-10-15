# `ui.file-upload`

Verifica que las subidas de archivos **validen tamaño y tipo antes de subir**,
muestren **progreso**, se puedan **cancelar y reintentar** y no se suban **dos
veces**. Perfil requerido: `file-upload`. Disponible desde el catálogo 2.0.0,
en `warn` por defecto.

## Declaración del equipo

`parameters.uploadsContract` → JSON (schema `ui-file-upload.contract`):

```json
{
  "schemaVersion": 1,
  "control": "ui.file-upload",
  "uploads": [{ "id": "avatar", "maxBytes": 5242880, "accept": ["image/jpeg", "image/png"], "cancel": "required", "retry": "required" }],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/avatar.adapter.js" }
}
```

`accept` admite tipos exactos y comodines (`image/*`). `*/*` exige
`parameters.allowAnyType`. Parámetro `maxBytesLimit` (100 MB).

## Adapter

```js
exports.createUploadUnderTest = ({ clock, transport, upload }) => ({
  select(file) {}, start() {}, cancel() {}, retry() {},
  view() { return { status, progress, error }; },
});
```

`file` es sintético (`{ name, type, size }`, sin contenido).
`transport.upload({ file, onProgress })` devuelve `{ done, abort() }`.

## Matriz de comportamiento (por punto de subida)

| Escenario | Qué se espera | Reglas |
|---|---|---|
| accept | un archivo válido se sube una vez, con progreso visible | `upload-complete`, `progress` |
| too-large | rechazo antes de subir, con mensaje legible | `size-limit`, `message-text` |
| wrong-type | rechazo antes de subir, con mensaje legible | `type-check`, `message-text` |
| cancel | cancelar aborta la transferencia | `cancel` |
| network-error | la falla se muestra y se puede reintentar | `error-state`, `retry` |
| double-start | iniciar dos veces sube una sola vez | `duplicate-upload` |

Remediaciones: [remediation.md](../remediation.md#uifile-upload-catálogo-200).
