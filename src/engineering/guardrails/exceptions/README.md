# Waivers y N/A gobernado (T13)

Dos tipos distintos (R18):

| | Waiver | N/A gobernado |
|---|---|---|
| Qué es | Deuda conocida y temporal sobre un incumplimiento | No aplicabilidad funcional |
| Schema | `schemas/engineering/waiver.schema.json` | `schemas/engineering/governed-na.schema.json` |
| Objetivo | `target.fingerprint` (finding exacto) o `target.ruleId` (condición/escenario exacto del control) | Sin finding |
| Prueba | — | `evidenceRef` (archivo del repo que debe existir) |
| Vence | `expiresAt` (≤ `exceptions.maxWaiverDays`, 90 por defecto) | `reviewAt` (≤ `exceptions.maxNaReviewDays`, 365 por defecto) |
| Aprobación | `approver` obligatorio y distinto del owner | `approver` si `criticality: high` (o `naApproval: always`) |
| Efecto | Finding `suppressed`; el resultado nunca queda `allow` limpio | Control `not_applicable` con referencia |

Ambos exigen `unitId`, `controlId`, owner, creación y `scope` verificable:
`paths` (globs **dentro de la raíz de la unidad**; `**`, `*` o globs de otra
unidad se rechazan) o `scopeHash` exacto. Un archivo por registro bajo
`.kiritek/engineering/waivers/` y `.kiritek/engineering/not-applicable/`
(configurable), así el historial queda en Git y la revisión pasa por
CODEOWNERS/PR.

## Reactivación (T13.4)

Un registro deja de aplicar —y el control vuelve a evaluarse— cuando:

- expira (`WAIVER_EXPIRED` / `GOVERNED_NA_EXPIRED`);
- el cambio sale de su alcance o cambia el `scopeHash` (`*_SCOPE_CHANGED`);
  un N/A acotado a parte de la unidad no cubre una evaluación completa;
- cambia la versión del control a la que se ató `controlVersion`
  (`*_CONTROL_CHANGED`);
- cambia el fingerprint (un waiver por fingerprint simplemente no casa).

Lo vencido se sigue cargando para poder diagnosticarlo; lo inválido se
rechaza con códigos (`SCHEMA_INVALID`, `GLOBAL_SCOPE`, `SELF_APPROVAL`,
`APPROVER_REQUIRED`, `EXPIRY_EXCESSIVE`, `EXPIRY_NOT_AFTER_CREATION`,
`CREATED_IN_FUTURE`, `NA_EVIDENCE_MISSING`, `UNKNOWN_UNIT`,
`UNKNOWN_CONTROL`, `RULE_OUTSIDE_CONTROL`, `DUPLICATE_ID`, `KIND_MISMATCH`,
`PARSE_ERROR`).

## Reporte

`report.exceptions` muestra `applied` (ref, unidad, control, vencimiento,
findings suprimidos), `reactivated`, `rejected` (archivo + códigos), `debt`
y `nextExpiry`; los eventos `exception-applied`/`exception-reactivated`
quedan en `report.events`. Nunca se publican razón, owner, aprobador ni
ticket.

Uso:

```js
const loaded = loadExceptions({ repoRoot, resolvedConfig, catalogSnapshot, nowIso });
await evaluateRun({ ...run, exceptions: loaded });
```
