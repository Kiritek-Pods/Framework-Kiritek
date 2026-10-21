# `web.module-announcement`

Verifica que los módulos web nuevos se anuncien explícitamente, a las
audiencias correctas y sin perjudicar accesibilidad. Perfiles requeridos:
`web` + `module-launch`. Momentos: agent y pre-commit (manifest), PR y
release (harness).

## Declaración del equipo

`parameters.launchManifest` → JSON (schema `web-module-announcement.manifest`):
módulos (`moduleId`, `announcementRequired`, `announcementId` o
`governedNaRef`), anuncios (versión, ventana, owner, audiencias sin PII,
canales y `fallbackChannel`, contenido por referencia con locales y
`missingContent`, show-once con clave/alcance/periodo/tratamiento sin storage,
rollout con historial) y N/A gobernados. `harness` opcional; sin harness los
tests faltan ⇒ `warn`.

## Adapter

```js
exports.createAnnouncementUnderTest = ({ clock, storage, viewer, locale, messages, rollout, prefersReducedMotion, announcement }) => ({
  async render() { return snapshot; },
  async press(key) { return snapshot; }, // "Tab" | "Escape"
});
```

El snapshot describe rol, nombre, controles, foco, colores y movimiento; la
traza sólo lleva hechos derivados (nunca texto ni identidades).

## Matriz de comportamiento (19 escenarios)

| Regla | Escenarios |
|---|---|
| `show-once` | first-visit, repeat-visit, storage-cleared, storage-unavailable, period-elapsed, other-viewer |
| `rollout` | rollout-paused (y reactivación), rollout-retired — el módulo sigue disponible |
| `targeting` | outside-window, audience-excluded |
| `keyboard`, `focus`, `name-role-state`, `close`, `contrast`, `reduced-motion` | uno por regla (WCAG AA) |
| `localization`, `content-fallback` | locale-fallback; missing-content, broken-markup |

| Estado | warn | enforce |
|---|---|---|
| módulo exige anuncio y falta señal | warn | deny |
| manifest/audiencia/canales/show-once inválidos | warn | deny |
| N/A inválido o vencido | warn | deny |
| test contractual falla | warn | deny |
| sólo ruta/diff sugiere módulo nuevo | warn (heurística) | warn |
| N/A válido o rollout paused/retired válido | allow | allow |

## Casos límite

- Storage no disponible: se aplica el tratamiento declarado (`suppress`,
  `once-per-session`, `show`) y el módulo nunca se rompe.
- Pausar/retirar el anuncio no retira el módulo y queda en el historial.
- Audiencias: sin emails, teléfonos, uuids ni IPs; los valores no se copian a
  la evidencia.
