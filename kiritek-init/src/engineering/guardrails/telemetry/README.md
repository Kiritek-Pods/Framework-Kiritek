# Telemetría engineering (T15A)

**Off por defecto.** `telemetry.enabled: true` en `kiritek-engineering.config.json`
registra eventos locales en `.kiritek/telemetry/engineering/events.jsonl`
(ignorado por Git, con retención `retentionDays`).

- `control-run`: IDs y versiones de pack/catálogo/control, referencia
  pseudónima de la unidad (hash), momento, nivel, plataforma y, según
  `categories`: estado/decisión/conteos, duración, cache y categoría de error.
  Nunca rutas, findings, razones, código ni datos de producto; cada evento
  pasa por allowlist + detector de fugas.
- `finding-feedback` (`guardrails feedback --verdict=confirmed|false-positive`):
  calidad para readiness (R20.2–R20.3), con el fingerprint pseudonimizado.
- Alertas agregadas (`telemetry status`): sólo contadores por control.

**Envío remoto** (`guardrails telemetry flush`), sólo con `enabled` +
`endpoint` https y el token en `KIRITEK_ENG_TELEMETRY_TOKEN` (nunca en config;
fuera del prefijo `KIRITEK_ENGINEERING_*`, que rechaza credenciales). Id de
instalación pseudónimo, `Idempotency-Key` por evento, timeout, anti-replay
(claves entregadas y ventana de retención). Sin `2xx` + ack de la misma clave
el evento queda `pending` y se conserva local.
