# `i18n.formatting`

Verifica que **fechas, números y montos** se muestren según el **idioma y país**
del usuario, en su **zona horaria**, con **idioma de respaldo** y sin **claves
internas** cuando falta una traducción. La referencia es `Intl` (ICU): no se
exige un texto exacto, sólo las convenciones del idioma. Perfil requerido:
`localized`. Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.i18nContract` → JSON (schema `i18n-formatting.contract`):

```json
{
  "schemaVersion": 1,
  "control": "i18n.formatting",
  "locales": ["es-CL", "en-US"],
  "defaultLocale": "es-CL",
  "currency": "CLP",
  "formats": ["date", "number", "currency", "timezone", "messages"],
  "harness": { "kind": "node-adapter", "adapter": "apps/web/test/i18n.adapter.js" }
}
```

## Adapter

```js
exports.createFormatterUnderTest = ({ locale, timeZone, currency, messages, defaultLocale }) => ({
  formatDate(epochMs) {}, formatNumber(n) {}, formatCurrency(amount) {}, t(key) {},
});
```

`messages` trae textos sintéticos por idioma. La traza sólo lleva booleanos.

## Matriz de comportamiento (por idioma, hasta 5)

| Escenario | Qué se verifica | Regla |
|---|---|---|
| date | año completo y orden día/mes del idioma (si el mes es numérico) | `date-format` |
| number | separador decimal del idioma | `number-format` |
| currency | símbolo o código de la moneda y el monto | `currency-format` |
| timezone | un instante cerca de medianoche cae en el día de la zona del usuario, no en el de UTC | `time-zone` |
| fallback | idioma no soportado ⇒ textos del idioma por defecto | `locale-fallback` |
| missing-key | traducción ausente ⇒ texto legible, nunca la clave | `missing-message` |

Remediaciones: [remediation.md](../remediation.md#i18nformatting-catálogo-200).
