# Runbooks

Cada runbook: síntoma → diagnóstico → acción → cierre. Ninguno requiere
desactivar el control para todo el repo ni usar `--no-verify`.

## Falso positivo

- **Síntoma**: un finding no corresponde a un defecto real.
- **Diagnóstico**: `scan` (JSON) → `results[].findingEvidence` indica si es
  `deterministic` o `heuristic`. Una heurística nunca bloquea: si molesta,
  agregue el contrato/manifest para reemplazarla por evidencia conductual.
- **Acción**: registre el veredicto (`feedback --control --rule --fingerprint
  --verdict=false-positive`). Si un deny determinista es incorrecto y bloquea,
  `promote --to=warn` para ese par (rollback inmediato) o un waiver temporal por
  `fingerprint` con ticket. Abra issue contra el control con el escenario.
- **Cierre**: la tasa de falsos positivos > 5 % impide promover (`doctor`).

## Flaky test (`conflict` / `FLAKY_SCENARIO`)

- **Síntoma**: estado `conflict`, diagnóstico `FLAKY_SCENARIO`.
- **Diagnóstico**: el harness corre cada escenario dos veces; difirieron. Causas
  típicas: reloj real en lugar del virtual, timers no cancelados, estado global
  compartido entre escenarios, aleatoriedad.
- **Acción**: use sólo `clock`/`transport`/`storage` inyectados; cree estado por
  sesión. Un conflicto nunca bloquea (es `error`/`warn`).
- **Cierre**: dos corridas idénticas → `verified`.

## Herramienta no disponible (`unavailable`, `ADAPTER_*`, `HARNESS_*`, `PLUGIN_*`)

- **Síntoma**: estado `unavailable`/`timeout`, exit 4 en CI.
- **Diagnóstico**: el diagnóstico nombra la causa (`ADAPTER_NOT_FOUND`,
  `HARNESS_TIMEOUT`, `PLUGIN_SANDBOX_UNAVAILABLE`, `BUDGET_EXHAUSTED`…).
- **Acción**: corrija la ruta del adapter/traza, suba el presupuesto del momento
  si es legítimo, use Node ≥ 22 para plugins. Nunca es incumplimiento.
- **Cierre**: `audit` vuelve a `verified` tras el siguiente scan.

## Evidencia `stale` o en `conflict`

- **Síntoma**: `audit` muestra `stale` ("evidencia de otra revisión") o `drift`.
- **Diagnóstico**: la última ejecución es de otro commit, otra config/catálogo o
  superó la frescura del control; `drift` también si un shim/hook fue alterado.
- **Acción**: vuelva a correr el scan del momento en la revisión actual; para
  `drift` de superficie, `update --surfaces=<s>` re-reconcilia.
- **Cierre**: evidencia stale nunca sostiene un deny; se renueva sola.

## Waiver / N/A

- **Síntoma**: necesita aceptar deuda temporal o declarar no aplicabilidad.
- **Acción**: cree el JSON en `.kiritek/engineering/waivers/` o
  `.kiritek/engineering/not-applicable/` (ver [configuration.md](configuration.md));
  revíselo por PR/CODEOWNERS. `audit` cuenta los rechazados; `scan` muestra
  `exceptions.rejected` con códigos (`SELF_APPROVAL`, `GLOBAL_SCOPE`,
  `EXPIRY_EXCESSIVE`, `NA_EVIDENCE_MISSING`…).
- **Cierre**: al vencer o salir del alcance el control se reactiva
  (`*_EXPIRED`, `*_SCOPE_CHANGED`); renueve con nueva justificación o corrija.

## Hard update defectuoso (`app.minimum-supported-version`)

- **Síntoma**: usuarios bloqueados por un hard update erróneo en producción.
- **Acción inmediata (operativa, fuera del pack)**: revierta la política remota
  (el contrato exige `rollback` sin publicar app) o aplique el override de
  emergencia autenticado, acotado por entorno, auditado y con expiración.
- **Prevención**: los escenarios `rollback`, `store-unavailable`,
  `grace-local-clock` y `lexicographic` del harness detectan las causas
  habituales; mantenga el control en PR y release.
- **Cierre**: revise la evidencia de release de esa versión y agregue el caso
  que faltó al adapter.

## Anuncio inaccesible (`web.module-announcement`)

- **Síntoma**: findings `keyboard`, `focus`, `name-role-state`, `close`,
  `contrast` o `reduced-motion`, o reportes de usuarios.
- **Acción**: pause el anuncio sin retirar el módulo (`rollout.state:
  "paused"` + entrada en `history`); corrija el componente y vuelva a `active`.
- **Cierre**: los 19 escenarios del harness pasan; `audit` en `verified`.
