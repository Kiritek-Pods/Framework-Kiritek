# Índice de evidencia — gates G.1–G.15

Este documento es el **índice de aceptación** de la suite de seguridad de
`kiritek-init`. Mapea cada gate global **G.1–G.15** (ver la matriz de cobertura
global en `tasks.md` y la guía operativa en [`SECURITY.md`](./SECURITY.md)) a
los **archivos de prueba reales** que lo cubren, junto con el registro de la
ejecución de aceptación (comando, plataforma, versión de Node, hash de
commit/configuración, timestamp y exit code).

> **Honestidad por diseño.** Un gate sin al menos un archivo de prueba que lo
> cubra es un **gap** y bloquea el cierre (tarea 44.7). El test automatizado
> `test/smoke/evidence-index.test.js` reafirma, en cada corrida, que todos los
> archivos listados aquí existen y que no queda ningún gate sin cubrir.

> **Sin secretos reales.** Este índice y su test usan únicamente **marcadores
> sintéticos**. El propio test escanea este archivo con el detector de canarios
> del redactor; cualquier canario reconocible lo haría fallar.

## Cómo leer este índice

- **Gate** — identificador global `G.x` y su criterio observable (texto de la
  matriz del plan).
- **Archivos de prueba que lo cubren** — rutas relativas a `kiritek-init/`.
  Todas deben existir; el test lo verifica.
- La columna **Alcance** resume qué demuestra la prueba para ese gate.

## Registro de la ejecución de aceptación

El registro **por corrida** (hash de commit, hash de configuración, plataforma,
comando, timestamp y exit code) **no** se versiona porque es específico de la
máquina/instante; se emite a la colección ignorada
`test/.acceptance-evidence/` (ver `.gitignore`). El generador
`test/smoke/acceptance-evidence.js` produce un registro con esta forma
(reutiliza el contrato de `src/domain/evidence.js`):

```json
{
  "schemaVersion": 1,
  "control": "task-44-acceptance",
  "command": "node --test",
  "toolVersion": "node <version>",
  "configHash": "<sha256 de la config efectiva o del árbol de pruebas>",
  "commit": "<git rev-parse HEAD, o 'uncommitted'>",
  "platform": "<process.platform> <os.release> <arch>",
  "scope": "G.1-G.15",
  "exitCode": 0,
  "decision": "allow",
  "createdAt": "<ISO-8601>"
}
```

El **índice** (este documento) sí se versiona: es el contrato de cobertura. El
**registro de corrida** se mantiene fuera de Git por ser datos de ejecución.

<!-- EVIDENCE-INDEX:BEGIN -->
## Matriz de evidencia G.1–G.15

| Gate | Criterio observable | Archivos de prueba que lo cubren | Alcance |
| --- | --- | --- | --- |
| G.1 | Instalación limpia sin stack con Gitleaks/hooks/audit | `test/integration/core-security-install.test.js`, `test/integration/checkpoint-core-stack-separation.test.js`, `test/unit/supply-chain.test.js`, `test/unit/gitleaks-runner.test.js` | Core se instala sin stack; manifiesto/pins/checksums; runner fijado. |
| G.2 | Init/update repetidos sin duplicar ni destruir | `test/integration/reconcile.test.js`, `test/integration/core-security-install.test.js`, `test/unit/inventory.test.js`, `test/unit/merge.test.js`, `test/integration/migrate.test.js` | Idempotencia byte-a-byte, rollback transaccional, merge no destructivo. |
| G.3 | Canario staged/push/history detectado | `test/integration/staged-scope.test.js`, `test/integration/push-scope.test.js`, `test/integration/push-scan.test.js`, `test/integration/gates-e2e.test.js` | Alcance staged/push exacto; escaneo por evento; canario detectado. |
| G.4 | Placeholder pasa; canario en example falla | `test/unit/policy-files.test.js`, `test/unit/gitleaks-runner.test.js`, `test/integration/gates-e2e.test.js` | Allowlist por ruta no anula detectores; placeholder permitido. |
| G.5 | Default/force/no-verify bloqueados | `test/unit/git-guards.test.js`, `test/integration/gates-e2e.test.js`, `test/integration/assistants-coexistence.test.js` | Guardas Git: push directo a default, `--force`, `--no-verify`. |
| G.6 | Conventional Commits + Jira local/remoto/fallback | `test/unit/policy-commits.test.js`, `test/integration/commit-msg.test.js`, `test/unit/jira.test.js`, `test/integration/jira-push.test.js` | Sintaxis commit + clave Jira; remoto 200/404/401/429/timeout + fallbacks. |
| G.7 | Secretos core; OWASP móvil preservado/redactado | `test/integration/checkpoint-core-stack-separation.test.js`, `test/integration/flutter-mobile-scanners.test.js`, `test/unit/mobile-adapter.test.js` | Secretos genéricos en el core; controles móviles especializados y redactados. |
| G.8 | CI sin push, permisos/pins/core commands | `test/unit/workflow-hardening.test.js`, `test/integration/push-scan.test.js`, `test/integration/github-pack.test.js`, `test/integration/checkpoint-providers-acceptance.test.js` | Workflow sin `git push`, permisos mínimos, actions por SHA, comandos core. |
| G.9 | AWS/GitHub instalables por separado | `test/integration/github-pack.test.js`, `test/integration/codecommit-pack.test.js`, `test/integration/provider-plan.test.js`, `test/integration/checkpoint-providers-acceptance.test.js` | Packs independientes; core y provider opuesto intactos; sin auto-apply. |
| G.10 | Limitación IAM/feature branch documentada/probada | `test/integration/codecommit-pack.test.js`, `test/integration/checkpoint-providers-acceptance.test.js`, `test/unit/incident-runbook.test.js` | Límite honesto: IAM sobre default no protege feature branches. |
| G.11 | Auditoría diferencia degradaciones y enforcement | `test/integration/audit.test.js`, `test/audit/checks.test.js`, `test/integration/provider-audit.test.js`, `test/integration/checkpoint-core-stack-separation.test.js` | Capas/estados por control; nunca infiere cumplimiento por existencia. |
| G.12 | Canario ausente en toda salida/telemetría | `test/integration/traceability-leak-scan.test.js`, `test/unit/redactor.test.js`, `test/unit/telemetry.test.js`, `test/unit/schema.test.js` | Barrido anti-fuga consolidado; redactor fail-closed; telemetría minimizada. |
| G.13 | Migración 0.1.0 warning + workflow + promote | `test/integration/migrate.test.js`, `test/integration/doctor-promote.test.js`, `test/unit/promotion.test.js`, `test/unit/workflow-hardening.test.js` | 0.1.0 preserva personalizaciones; workflow corregido; promoción gobernada. |
| G.14 | Matriz CI por plataforma con evidencia | `test/unit/platform-preflight.test.js`, `test/integration/platform-paths.test.js`, `test/smoke/compat-matrix.test.js` | Matriz CI 3 OS; capacidades POSIX declaradas; skips con razón. |
| G.15 | Ausencia de detector de autoría IA como gate | `test/unit/docs-lint.test.js`, `test/smoke/no-ai-authorship-gate.test.js` | Ningún gate bloquea por "autoría IA"; prohibición explícita en docs y código. |
<!-- EVIDENCE-INDEX:END -->

## Notas de cobertura por subtarea de la tarea 44

- **44.1 (unitarias):** parser/config (`cli-parser`, `config`, `security-cli`),
  branches/scopes/refspecs (`git-guards`, `push-scope`, `staged-scope`),
  commits/Jira (`policy-commits`, `jira`), redacción (`redactor`,
  `report-writer`), allowlists (`policy-files`), manifests/merge
  (`supply-chain`, `inventory`, `merge`), políticas/excepciones
  (`policy-exceptions`), auditoría (`audit/checks`, `audit`).
- **44.2 (integración Git):** `hooks`, `staged-scope`, `push-scope`,
  `push-scan`, `git-guards`, `reconcile`, `assistants-coexistence`.
- **44.3 (smoke):** `core-security-install` (limpio/repetido/warning/enforce/sin
  Git), `migrate` (update 0.1.0/parcial), `jira-push` (sin Jira), trampas de red
  (`checkpoint-*`), `provider-plan` (provider aislado).
- **44.4 (escenarios):** `jira` (200/404/401/429/timeout + fallbacks),
  `flutter-mobile-scanners` (Flutter/no Flutter), `audit`/`audit/checks`
  (sana/degradada), `telemetry` (off/on).
- **44.5 (multiplataforma):** la matriz CI vive en
  `templates/core/security/ci/github/kiritek-compat-matrix.yml` (ubuntu/macos/
  windows × Node 18/20). Las pruebas POSIX-only (symlinks, modos de archivo,
  hooks `sh`) **se saltan con razón registrada** en Windows; nunca en silencio.
  No se añaden runners Windows reales aquí: se afirma la matriz y la disciplina
  de skip (`test/smoke/compat-matrix.test.js`).
- **44.6 (workflows/pins/no-push + barrido anti-canario):**
  `workflow-hardening`, `traceability-leak-scan` y el barrido consolidado de los
  checkpoints.
- **44.7 (este índice):** `test/smoke/evidence-index.test.js` afirma que cada
  gate está mapeado a ≥1 archivo existente y que el índice no tiene gaps.
