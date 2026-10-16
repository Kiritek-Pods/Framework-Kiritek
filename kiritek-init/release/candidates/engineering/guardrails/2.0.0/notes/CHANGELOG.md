# engineering/guardrails — catálogo 2.0.0

Candidato de disponibilidad general (gate T17). Sólo se publica en
`catalogs/` cuando `scripts/release-gate.js --approve` acepta evidencia
completa (G1–G7, R27 y matriz de plataformas).

## Cambios

- Perfiles nuevos: `data-views`, `forms`, `network-client`, `feature-flags`,
  `auth-session`, `file-upload`, `paginated-lists`, `analytics`,
  `destructive-actions`, `localized`, `offline-capable`, `device-permissions`,
  `routed-app`, `dialogs`, `http-api`, `backend-service`.
- Controles nuevos (versión 1.0.0, `warn` por defecto): `ui.data-states`,
  `ui.form-validation`, `net.resilient-requests`, `flags.lifecycle`,
  `auth.session-expiry`, `ui.file-upload`, `ui.pagination`,
  `analytics.events`, `ui.destructive-actions`, `i18n.formatting`,
  `app.offline-mode`, `app.device-permissions`, `nav.broken-routes`,
  `ui.accessible-dialogs` y, de backend, `api.idempotency`,
  `api.error-responses`, `api.rate-limit`, `api.pagination`,
  `svc.dependency-failure`, `svc.health-shutdown`. Cada
  uno exige su perfil declarado y su contrato; sin contrato sólo avisa.
- Los veintitrés controles declaran `enforce` en `supportedLevels` y un
  `enforcementContract` ligado a su suite R27 (`kiritek/engineering/<control>@1.0.0`).
- Momentos de enforcement: sólo `pr` y `release`. Agent y pre-commit siguen
  siendo warning (no hay ruta de bloqueo local).
- Evidencia apta para `deny`: sólo `deterministic`. Heurísticas, timeouts,
  conflictos, `unavailable` y evidencia vencida nunca bloquean.

## Sin cambios

- Nivel por defecto: `warn` en todos los controles. Ningún repo bloquea por
  actualizar; promover sigue siendo `guardrails promote` explícito, por
  unidad/control, tras `doctor`.
- Versión y comportamiento de los tres controles iniciales (`1.0.0`): mismos collectors,
  harness, parámetros y reglas. Los waivers fijados a `controlVersion` 1.0.0
  siguen vigentes.

Migración: `notes/MIGRATION-1.0.0-to-2.0.0.md`.
