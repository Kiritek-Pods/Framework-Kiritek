# Control `web.module-announcement`

Verifica que los módulos web nuevos se anuncien de forma explícita, a las
audiencias correctas y sin perjudicar accesibilidad (R11). Perfiles
`web` + `module-launch`. Estado inicial del catálogo 1.0.0: `off|warn`.

Evidencia determinista (R11.9) — lo único que puede llegar a bloquear:

1. **Launch manifest** (`parameters.launchManifest`, schema
   `schemas/engineering/controls/web-module-announcement.manifest.schema.json`):
   vincula cada `moduleId` con `announcementId` o `governedNaRef`. El anuncio
   declara versión, ventana, owner, audiencias, canales, contenido por
   referencia (`titleRef`/`bodyRef`, locales, `defaultLocale`,
   `missingContent`), show-once (`key`, `audienceScope`, `periodDays`,
   `storageUnavailable`) y rollout (`draft|active|paused|retired` + historial).
2. **Harness conductual** con reloj virtual, storage, viewer, rollout y
   mensajes sintéticos.

Sin manifest, una ruta del cambio con forma de entrada de módulo
(`modules|features|pages|routes|app/<x>/index|page|route…`) sólo produce
`warn` heurístico pidiendo confirmar el lanzamiento (R11.10).

## Adapter (`node-adapter`)

```js
exports.createAnnouncementUnderTest = ({ clock, storage, viewer, locale, messages, rollout, prefersReducedMotion, announcement }) => ({
  async render() { return snapshot; },      // monta/navega la página del módulo
  async press(key) { return snapshot; },    // "Tab" | "Escape"
});
// snapshot: { moduleAvailable, focus: "announcement"|"control:<id>"|"origin",
//   announcement: null | { role, modal, name, title, body,
//     controls: [{ id: "close"|…, name, keyboard }], colors: { text, background },
//     motion: { animated, durationMs } } }
```

- Cada llamada a la factory es una sesión; `storage` (estilo
  `localStorage`) persiste entre sesiones y puede lanzar (no disponible).
- La traza sólo contiene hechos derivados (booleanos, enums, ratio de
  contraste). Texto renderizado, identidades y campos desconocidos del
  snapshot nunca salen del proceso hijo (sólo se cuentan: `droppedFields`).
- Se prueba la política del primer anuncio no retirado del manifest.
- Stacks no-JS: `harness.kind = "trace-command"` y la traza estándar
  (`web-module-announcement.trace.schema.json`).

## Reglas

Manifest: `metadata-invalid` (JSON/schema/ids duplicados),
`required-signal-missing` (módulo con `announcementRequired` sin anuncio
existente ni N/A), `invalid-na` (inexistente, de otro módulo, vencido o
criticidad alta sin segunda aprobación), `window`, `audience-pii` (atributo
fuera de la lista permitida o valores con email/teléfono/uuid/ip),
`channels-unsupported`, `channel-unreachable` (sin canal soportado ni
`fallbackChannel`), `content-localization`, `show-once-key` (clave
repetida), `rollout-traceability` (estado ≠ última entrada del historial u
historial desordenado).

Comportamiento (19 escenarios):

| Regla | Escenarios |
|---|---|
| `show-once` | first-visit, repeat-visit, storage-cleared, storage-unavailable, period-elapsed, other-viewer |
| `rollout` | rollout-paused (y reactivación), rollout-retired — el módulo sigue disponible |
| `targeting` | outside-window, audience-excluded |
| `keyboard`, `focus`, `name-role-state`, `close`, `contrast`, `reduced-motion` | uno cada una (WCAG AA: 4.5:1) |
| `localization`, `content-fallback` | locale-fallback; missing-content, broken-markup |

Faltar tests no es incumplimiento (sólo `warn`); un adapter que falla al
montar o un harness sin traza deja evidencia incompleta, nunca deny. Un
N/A vigente o un rollout `paused`/`retired` válido ⇒ `allow`.
