# engineering/guardrails — catálogo 1.0.0

Primera versión publicada del catálogo.

- Perfiles builtin: `web`, `mobile-app`, `search`, `module-launch`.
- Controles iniciales, **sólo `off|warn`** (sin contrato de enforcement):
  `search.input-rate`, `app.minimum-supported-version`,
  `web.module-announcement`.
- Ningún control soporta `enforce` hasta que su suite de conformidad esté
  aprobada (R27). Promover a `enforce` requerirá una versión nueva del
  catálogo con `enforcementContract` y notas de migración.
