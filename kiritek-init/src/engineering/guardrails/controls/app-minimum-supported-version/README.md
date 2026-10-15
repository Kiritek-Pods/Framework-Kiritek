# Control `app.minimum-supported-version`

Verifica que la política de versión mínima de una app (`mobile-app`) sea
fiable y no bloquee usuarios por errores de configuración o conectividad
(R10). Estado inicial del catálogo 1.0.0: `off|warn`.

Dos fuentes de evidencia determinista (R10.12):

1. **Contrato de política** (`parameters.policyContract`, schema
   `schemas/engineering/controls/app-minimum-supported-version.contract.schema.json`):
   fuente y autenticidad por entorno, cache/offline, gracia con fuente
   temporal, hard/soft, stores con fallback, rollback, override y
   observabilidad.
2. **Harness conductual** con reloj virtual y transporte/cache/stores
   inyectados (nunca la fuente remota real).

## Adapter (`node-adapter`)

```js
exports.createVersionGateUnderTest = ({ clock, transport, cache, stores, platform, installedVersion, environment }) => ({
  async evaluate() {
    return { action, canContinue, canPostpone, updateTarget, explanationAccessible, exitAvailable, policySource };
  },
});
```

- `clock`: reloj **local** del dispositivo (puede estar manipulado); el
  tiempo confiable llega como `serverTime` en la respuesta del transporte.
- `transport.fetchPolicy({ environment, signal })` →
  `{ policy: { minimumVersion, softMinimumVersion?, graceUntil?, overrides? }, signature, serverTime }`.
- La decisión se sanea: campos desconocidos (p. ej. tokens) se descartan.
- Stacks no-JS: `harness.kind = "trace-command"` y la traza estándar
  (`app-minimum-supported-version.trace.schema.json`).

## Reglas

Contrato: `contract-invalid`, `contract-source-authenticity`,
`contract-environments`, `contract-timeout`, `contract-cache`,
`contract-offline`, `contract-grace`, `contract-hard-exit`, `contract-soft`,
`contract-store-fallback`, `contract-rollback`, `contract-override`,
`contract-observability`.

Comportamiento (21 escenarios, más `enterprise-store` si se declara):
`version-comparison` (menor/igual/mayor, prerelease, build metadata, trampa
lexicográfica `1.10.0` vs `1.9.0`), `hard-flow`, `soft-flow`,
`untrusted-payload` (payload/firma inválidos), `timeout`, `offline-policy`,
`grace` (incluye reloj local manipulado), `store-fallback`, `rollback`,
`override`. Si la acción es incorrecta sólo se reporta esa causa raíz.

La indisponibilidad de la fuente remota durante el análisis (o un harness
que la declara) es estado operativo `unavailable`, nunca deny. Sin contrato,
las señales estáticas sólo producen `warn`.
