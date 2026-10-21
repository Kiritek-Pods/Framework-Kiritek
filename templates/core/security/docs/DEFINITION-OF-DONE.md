# Definition of Done — aceptación de la iniciativa (tarea 45)

Este documento es el **acta de aceptación terminal** de la iniciativa
"Seguridad integral para `kiritek-init`". Mapea cada criterio de Definition of
Done **45.1–45.9** del plan (`tasks.md`, checkpoint final `[CP] 45`) a las
**tareas completadas**, los **archivos de prueba reales** y los **documentos**
que lo sostienen.

Complementa, sin duplicar, dos índices ya existentes:

- La **matriz de requisitos 1–28** y la **matriz de gates G.1–G.15** viven en
  `tasks.md`.
- El **índice de evidencia por gate** (G.1–G.15 → archivos de prueba) vive en
  [`EVIDENCE-INDEX.md`](./EVIDENCE-INDEX.md) y lo reafirma en cada corrida
  `test/smoke/evidence-index.test.js`.

Este documento cierra el bucle en el nivel de **criterios de aceptación de la
iniciativa**: un criterio DoD sin al menos un artefacto real que lo sostenga es
un **gap** y bloquea el *release candidate*. El test automatizado
`test/smoke/definition-of-done.test.js` reafirma, en cada corrida, que:

1. Los nueve criterios 45.1–45.9 están presentes en la matriz de abajo.
2. Cada criterio mapea a ≥1 archivo real (prueba o documento) y **todos existen**.
3. Cada archivo de prueba mapeado es un `.test.js` real bajo `test/`.
4. La suite completa queda **verde y sin skips** en el momento de la aceptación.
5. Este documento no filtra ningún canario (barrido con el detector del redactor).

> **Honestidad por diseño.** Este acta no afirma cobertura que no exista. Si un
> criterio no estuviera sostenido por artefactos reales, se registraría como
> **gap** (tarea correctiva enlazada al criterio), no como aprobado.

> **Sin secretos reales.** Este documento y su test usan únicamente
> **marcadores sintéticos**. El test escanea este archivo con el detector de
> canarios del redactor; cualquier canario reconocible lo haría fallar.

## Estado de aceptación

- **Suite:** `npm test` (ver `package.json` → `node --test`).
- **Resultado al cierre:** 702 pruebas, 702 pass, 0 fail, 0 skipped (exit 0).
- **Runtime:** Node v20.20.2 (CommonJS, Node >=18).
- **Veredicto:** `RELEASE-CANDIDATE` — 45.1–45.9 sostenidos por artefactos
  reales y suite verde sin omisiones.

El registro **por corrida** (commit/config hash, plataforma, comando,
timestamp, exit code) se emite a la colección ignorada
`test/.acceptance-evidence/` mediante `test/smoke/acceptance-evidence.js`
(reutiliza el contrato de `src/domain/evidence.js`). Sólo este acta y el índice
de evidencia se versionan; los datos de corrida no.

## Cómo leer esta matriz

- **Criterio** — identificador DoD `45.x` y su enunciado del plan.
- **Tareas** — tareas del plan que lo implementan/demuestran (ya completadas).
- **Artefactos que lo sostienen** — rutas relativas a `kiritek-init/`. Las
  rutas `test/**/*.test.js` son pruebas; el resto son documentos/artefactos.
  Todas deben existir; el test lo verifica.

<!-- DEFINITION-OF-DONE:BEGIN -->
## Matriz de aceptación 45.1–45.9

| Criterio | Enunciado (resumen) | Tareas | Artefactos que lo sostienen |
| --- | --- | --- | --- |
| 45.1 | Criterios 1–28 y G.1–G.15 mapeados a tareas completadas y evidencia vigente | 44, 43 | `test/smoke/evidence-index.test.js`, `templates/core/security/docs/EVIDENCE-INDEX.md`, `templates/core/security/docs/SECURITY.md` |
| 45.2 | Core instala sin stack, idempotente/transaccional; warning/enforcement con detector/alcance idéntico | 9, 10, 33 | `test/integration/core-security-install.test.js`, `test/integration/reconcile.test.js`, `test/integration/doctor-promote.test.js`, `test/unit/promotion.test.js` |
| 45.3 | Staged/push/CI detectan canarios en su alcance; placeholders pasan; ningún output reconstruye el secreto | 13, 14, 18 | `test/integration/staged-scope.test.js`, `test/integration/push-scope.test.js`, `test/integration/push-scan.test.js`, `test/integration/gates-e2e.test.js`, `test/unit/policy-files.test.js` |
| 45.4 | Auditoría distingue capas/estados y nunca infiere cumplimiento por existencia | 20, 28 | `test/integration/audit.test.js`, `test/audit/checks.test.js`, `test/integration/provider-audit.test.js` |
| 45.5 | Migración 0.1.0 conserva personalizaciones y corrige el workflow sin push directo | 35, 19 | `test/integration/migrate.test.js`, `test/unit/workflow-hardening.test.js` |
| 45.6 | Claude/Kiro/Jira/Flutter funcionan o declaran unavailable/no aplicable con precisión | 24, 25, 23, 27 | `test/integration/assistants-coexistence.test.js`, `test/unit/jira.test.js`, `test/integration/jira-push.test.js`, `test/integration/flutter-mobile-scanners.test.js`, `test/unit/mobile-adapter.test.js` |
| 45.7 | GitHub y AWS validan por separado, con pins/permisos mínimos, sin autoaplicar cloud | 38, 39, 40, 42 | `test/integration/github-pack.test.js`, `test/integration/codecommit-pack.test.js`, `test/integration/provider-plan.test.js`, `test/integration/checkpoint-providers-acceptance.test.js` |
| 45.8 | Matriz multiplataforma, docs, runbooks, changelog, supply chain y rollback completos | 36, 43, 44 | `test/smoke/compat-matrix.test.js`, `test/unit/docs-lint.test.js`, `test/unit/supply-chain.test.js`, `templates/core/security/docs/MIGRATION.md`, `templates/core/security/docs/INCIDENT-RESPONSE.md`, `templates/core/security/docs/CHANGELOG.md`, `templates/core/security/docs/RELEASE.md`, `templates/core/security/docs/COMPATIBILITY.md` |
| 45.9 | No existe detector de autoría IA en ninguna ruta de bloqueo | 43, 44 | `test/smoke/no-ai-authorship-gate.test.js`, `test/unit/docs-lint.test.js` |
<!-- DEFINITION-OF-DONE:END -->

## Mapeo DoD → requisitos/gates

Cada criterio DoD cierra un subconjunto de los requisitos 1–28 y gates
G.1–G.15 ya mapeados en las matrices de `tasks.md`:

- **45.1** → requisito 26 + todos los gates G.1–G.15 (índice de evidencia).
- **45.2** → requisitos 1, 20, 21, 22; gates G.1, G.2, G.13.
- **45.3** → requisitos 2, 3, 5, 15; gates G.3, G.4.
- **45.4** → requisitos 11, 14; gate G.11.
- **45.5** → requisitos 19, 21; gates G.2, G.8, G.13.
- **45.6** → requisitos 6, 9, 10, 12; gates G.5, G.6, G.7.
- **45.7** → requisitos 16, 17, 24; gates G.8, G.9, G.10.
- **45.8** → requisitos 23, 24, 27; gate G.14.
- **45.9** → requisito 26.10; gate G.15.

## Gaps abiertos

Ninguno al cierre. Si una validación futura revelara un gap, se abriría una
tarea correctiva enlazada al criterio DoD afectado (p. ej. "45.4 — auditoría no
distingue estado X") y se repetiría sólo la validación afectada antes de
reemitir el *release candidate*.
