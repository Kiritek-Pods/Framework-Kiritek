# engineering/guardrails — catálogo 2.0.0

Candidato de disponibilidad general (gate T17). Sólo se publica en
`catalogs/` cuando `scripts/release-gate.js --approve` acepta evidencia
completa (G1–G7, R27 y matriz de plataformas).

## Cambios

- Los tres controles iniciales declaran `enforce` en `supportedLevels` y un
  `enforcementContract` ligado a su suite R27 (`kiritek/engineering/<control>@1.0.0`):
  - `search.input-rate`
  - `app.minimum-supported-version`
  - `web.module-announcement`
- Momentos de enforcement: sólo `pr` y `release`. Agent y pre-commit siguen
  siendo warning (no hay ruta de bloqueo local).
- Evidencia apta para `deny`: sólo `deterministic`. Heurísticas, timeouts,
  conflictos, `unavailable` y evidencia vencida nunca bloquean.

## Sin cambios

- Nivel por defecto: `warn` en los tres controles. Ningún repo bloquea por
  actualizar; promover sigue siendo `guardrails promote` explícito, por
  unidad/control, tras `doctor`.
- Versión y comportamiento de los controles (`1.0.0`): mismos collectors,
  harness, parámetros y reglas. Los waivers fijados a `controlVersion` 1.0.0
  siguen vigentes.

Migración: `notes/MIGRATION-1.0.0-to-2.0.0.md`.
