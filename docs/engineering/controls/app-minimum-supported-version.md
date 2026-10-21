# `app.minimum-supported-version`

Verifica que la política de versión mínima de una app móvil sea fiable y no
bloquee usuarios por error de configuración o conectividad. Perfil requerido:
`mobile-app`. Momentos: pre-commit (sólo contrato), PR y release (harness).

## Declaración del equipo

`parameters.policyContract` → JSON (schema `app-minimum-supported-version.contract`)
con, por entorno: fuente y autenticidad (`signature` + `keyId`, auth del
proveedor o pinning), cache/staleIfOffline, timeout; además offline (primera
ejecución y cache expirada), gracia (fuente de tiempo confiable y máximo),
hard/soft, stores con fallback, rollback sin publicar app, override de
emergencia y observabilidad sin identificadores en claro.

## Adapter

```js
exports.createVersionGateUnderTest = ({ clock, transport, cache, stores, platform, installedVersion, environment }) => ({
  async evaluate() {
    return { action, canContinue, canPostpone, updateTarget, explanationAccessible, exitAvailable, policySource };
  },
});
```

`clock` es el reloj **local** del dispositivo (puede estar manipulado); el
tiempo confiable llega como `serverTime`. Campos extra de la decisión (p. ej.
tokens) se descartan y sólo se cuentan.

## Matriz de comportamiento (21 escenarios)

| Grupo | Escenarios | Regla |
|---|---|---|
| comparación | below-min, equal-min, above-min, prerelease-below, build-metadata, lexicographic (`1.10.0` vs `1.9.0`) | `version-comparison` |
| flujos | below-min (hard), soft | `hard-flow`, `soft-flow` |
| confianza | invalid-payload, invalid-signature | `untrusted-payload` |
| red | timeout, offline-first-run, offline-valid-cache, offline-expired-cache | `timeout`, `offline-policy` |
| gracia | grace-active, grace-local-clock | `grace` |
| stores | store-unavailable (+ enterprise si se declara) | `store-fallback` |
| operación | rollback, override-valid, override-expired, override-unauthenticated, override-other-environment | `rollback`, `override` |

| Estado | warn | enforce |
|---|---|---|
| contrato inválido o regla de contrato incumplida | warn | deny en PR/release |
| escenario determinista falla | warn | deny |
| fuente remota inaccesible durante el análisis | error operativo | error operativo, nunca deny |
| flaky / conflicto | warn / error | error |
| sólo nombres o config inferida | warn (heurística) | warn |

## Casos límite

- El análisis nunca contacta la fuente real: transporte inyectado o fixture.
- Si la acción es incorrecta sólo se reporta la causa raíz (no los campos derivados).
- Un hard update siempre conserva acción accesible y salida documentada.
