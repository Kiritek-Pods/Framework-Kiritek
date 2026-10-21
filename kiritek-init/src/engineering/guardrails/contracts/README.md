# Contratos — engineering/guardrails

Contratos versionados del pack `engineering/guardrails` (tarea T01). Están
separados de `core/security`: reutilizan `src/domain/result.js` (PolicyResult
v1) sin modificarlo y añaden su propio envelope v2.

| Módulo | Contrato | Schema |
| --- | --- | --- |
| `common.js` | Enums (`level`, `moment`, `confidence`, `evidenceClass`, `freshness`), guardias de ID/semver/hash/ruta, `Diagnostic`, `Provenance`, `CatalogRef`, `ProfileRef` | `engineering/common` |
| `profile.js` | `Profile` declarado (`explicit`/`inherited`) o sugerido por discovery | `engineering/profile` |
| `unit.js` | `Unit` de monorepo con roots/globs relativos | `engineering/unit` |
| `control.js` | `ControlDefinition` con `defaults` (nivel `off`/`warn` + parámetros); `enforce` exige `enforcementContract` | `engineering/control` |
| `catalog.js` | `Catalog` inmutable direccionado por digest | `engineering/catalog` |
| `observation.js` | `Observation` de un collector; no admite campos de decisión | `engineering/observation` |
| `applicability.js` | `Applicability` (`applicable`/`not_applicable`/`unknown`/`unavailable`) | `engineering/applicability` |
| `evidence.js` | `EngineeringEvidence` v2 y `evaluateFreshness` | `engineering/evidence` |
| `practice-input.js` | `PracticeInput` autocontenido para evaluators puros | `engineering/practice-input` |
| `policy-result.js` | Adaptador de PolicyResult v1 (sin cambios en security) | `result` |
| `result-envelope.js` | `EngineeringResultEnvelope` v2, estados de evaluación y predicado `mayDeny` | `engineering/result-envelope` |
| `domain.js` | Separación security/engineering y agregado multidominio | — |

## Invariantes

- Contratos cerrados: las propiedades desconocidas se rechazan con código
  `UNKNOWN_PROPERTY`; los IDs, versiones, hashes y rutas inválidos tienen su
  propio código (`ID_NOT_NAMESPACED`, `INVALID_VERSION`, `INVALID_HASH`,
  `ABSOLUTE_PATH`, `PATH_ESCAPE`, `UNRECOGNIZED_STATE`).
- Las zonas libres (`facts`, `parameters`, `effectiveConfig`) se barren en
  profundidad buscando campos prohibidos (`FORBIDDEN_FIELD`): código, queries,
  payloads, tokens, PII.
- `off`, `not_evaluated`, `not_applicable`, `unknown`, `unavailable`,
  `timeout`, `conflict` y `stale` son estados distintos; ninguno admite
  `allow` ni `deny`.
- `blockingEligible` es derivado (design §9.2) y además exige momento dentro
  de `control.enforcementMoments` y `evidenceCompleteness: complete`; sólo
  findings deterministas cuentan como bloqueantes. Un `deny` que no cumple el
  predicado lanza `DENY_NOT_ELIGIBLE`; el orquestador (T06) debe degradarlo
  antes.
- Un `allow` de un dominio no prueba conformidad del otro, y un pack ausente
  se reporta `not-installed`, nunca `failed`.

## Schemas

Los schemas viven en `schemas/engineering/*.schema.json` y requieren el modo
`extended` de `src/domain/schema-validator.js`
(`validateAgainst("engineering/unit", value, { extended: true })`), que añade
`pattern`, `minItems`, `uniqueItems` y `$ref` entre schemas del registro. Los
schemas security se siguen validando sin ese modo.

## Pruebas

`test/engineering/unit/contracts.test.js` y
`test/engineering/unit/domain-separation.test.js`, con fixtures en
`test/engineering/fixtures/contracts/{valid,invalid}`. Requieren Node >= 18
(`nvm use` toma la versión de `.nvmrc`).
