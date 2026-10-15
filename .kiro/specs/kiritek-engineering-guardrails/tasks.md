# Plan de implementación — Kiritek Engineering Guardrails

## 1. Convenciones del plan

- **Pack:** `engineering/guardrails`, independiente de `core/security`.
- **Ruta crítica (CP):** T01 → T02 → T03 → T04 → T05 → T06 → T10–T12 → T13 → T14 → T15 → T16.
- **[P]:** tarea paralelizable cuando sus dependencias estén completas.
- **[CP]:** checkpoint obligatorio; no se inicia la fase siguiente indicada hasta superarlo.
- Ninguna tarea habilita `enforce` antes de demostrar R27 y los predicados anti-falso-positivo.
- Cada validación debe conservar comando, versión, revisión, catálogo, config hash, alcance y exit code sin persistir código, prompts, queries, payloads ni PII.
- Los tres controles iniciales se entregan primero en `warn`; la promoción a `enforce` es posterior, explícita y por unidad/control.

## Fase 1 — Contratos, schemas y aislamiento de dominio

- [x] **T01. Crear contratos versionados del dominio engineering** **[CP]**
  - **Depende de:** ninguna.
  - **Objetivo/rutas:** `src/engineering/guardrails/contracts/**`, `schemas/engineering/**`, adaptación explícita de `src/domain/result.js` sin modificar la semántica security.
  - [x] T01.1 Implementar y validar `Profile`, `Unit`, `Catalog`, `ControlDefinition`, `Observation`, `Applicability`, `PracticeInput`, `EngineeringEvidence` y `EngineeringResultEnvelope`.
  - [x] T01.2 Mantener `PolicyResult` v1 como payload interno y crear envelope v2 con `domain`, pack, catálogo, unidad, perfiles, momento, confianza, aplicabilidad, frescura y elegibilidad de bloqueo.
  - [x] T01.3 Rechazar propiedades desconocidas, IDs no namespaceados, versiones inválidas, rutas absolutas y estados no reconocidos.
  - [x] T01.4 Definir estados independientes para `off`, `not_evaluated`, `not_applicable`, `unknown`, `unavailable`, `timeout`, `conflict` y `stale`; ninguno equivale a `allow` verificado.
  - [x] T01.5 Implementar fixtures y pruebas de round-trip/schema, compatibilidad PolicyResult v1 y separación de resultados security/engineering.
  - [x] T01.6 **Validar gate:** ningún `allow` de un dominio prueba conformidad del otro y pack ausente no rompe auditoría security.
  - **Requisitos:** R1, R5–R8, R16, R27; G1, G5.

## Fase 2 — Catálogo reproducible y configuración independiente

- [x] **T02. Implementar catálogo versionado, fijado y verificable** **[CP]**
  - **Depende de:** T01.
  - **Objetivo/rutas:** `src/engineering/guardrails/catalog/**`, `catalogs/engineering/guardrails/1.0.0/**`, schemas de catálogo/control/perfil.
  - [x] T02.1 Publicar catálogo inicial con versiones exactas, digest SHA-256, compatibilidad, perfiles, momentos, parámetros, niveles soportados y contratos de enforcement.
  - [x] T02.2 Resolver una sola snapshot inmutable por ejecución; prohibir `latest`, fallback silencioso y mezcla de versiones.
  - [x] T02.3 Implementar verificación de digest/firma opcional, cache segura, modo offline, diff, deprecaciones y migraciones semánticas.
  - [x] T02.4 Crear suite de conformidad para catálogos/plugins y rechazar controles que declaren `enforce` sin contrato aprobado.
  - [x] T02.5 **Validar gate:** misma revisión+config+catálogo produce resolución idéntica; mismatch/incompatibilidad falla antes de evaluar.
  - **Requisitos:** R4, R22, R25–R27; G1, G6.

- [x] **T03. Implementar configuración engineering con procedencia por hoja** **[CP]**
  - **Depende de:** T01–T02.
  - **Objetivo/rutas:** `src/engineering/guardrails/config/**`, `schemas/engineering/config.schema.json`, template `kiritek-engineering.config.json`.
  - [x] T03.1 Soportar `off|warn|enforce` por control, unidades, perfiles, parámetros, budgets, evidencia, waivers, N/A, plugins y telemetría.
  - [x] T03.2 Implementar precedencia flags allowlisted > env allowlisted > unidad > repo > organización verificada > catálogo.
  - [x] T03.3 Mantener procedencia de cada valor y locks organizacionales; conflictos o ambigüedad deben fallar explícitamente.
  - [x] T03.4 Impedir que `mode` de security eleve o reduzca niveles engineering.
  - [x] T03.5 Rechazar secretos/credenciales por flags, campos desconocidos, roots fuera del repo y `enforce` no soportado.
  - [x] T03.6 **Validar gate:** tabla completa de precedencia, overrides multiunidad, locks, config inválida y origen efectivo redactado.
  - **Requisitos:** R1–R4, R14, R20, R22; G1–G2.

## Fase 3 — Perfiles, unidades y alcance de monorepo

- [x] **T04. Resolver perfiles funcionales y unidades explícitas** **[CP]**
  - **Depende de:** T02–T03.
  - **Objetivo/rutas:** `src/engineering/guardrails/workspace/{discover,units,identity,ownership}.js`.
  - [x] T04.1 Soportar `web`, `mobile-app`, `search`, `module-launch` y perfiles namespaceados extensibles por unidad.
  - [x] T04.2 Hacer que detección de stack/rutas/dependencias sólo produzca sugerencias con confianza y razones; nunca activar perfiles o enforcement.
  - [x] T04.3 Resolver herencia explícita, parámetros, perfiles compuestos, IDs estables, aliases gobernados y roots confinados.
  - [x] T04.4 Distinguir perfil no declarado, sugerido, heredado y explícito en auditoría/salida.
  - [x] T04.5 Probar repos sin perfil, unidades superpuestas, symlinks, rutas Unicode/espacios y perfiles incompatibles.
  - **Requisitos:** R2, R5, R14, R23, R26; G2, G6.

- [x] **T05. Implementar ownership, grafo de impacto y alcance multiunidad** **[CP]**
  - **Depende de:** T04.
  - **Objetivo/rutas:** `src/engineering/guardrails/workspace/{impact-graph,scope}.js`, integración staged/PR/release.
  - [x] T05.1 Mapear paths a unidades por `owns/excludes`, shared paths y dependencias, preservando razones.
  - [x] T05.2 Resolver ciclos como componentes, deduplicar y expandir ante ambigüedad o fallar según política; nunca reducir cobertura silenciosamente.
  - [x] T05.3 Evaluar staged exacto en pre-commit, rango completo en PR y artefacto/unidades seleccionadas en release.
  - [x] T05.4 Particionar evidencia, cache, waiver y N/A por unidad/control/perfil/catálogo.
  - [x] T05.5 Probar monorepos, worktrees, moves/renames, cambios compartidos, ranges incompletos y repos shallow.
  - [x] T05.6 **Validar gate:** cada path tiene owner o diagnóstico; ambigüedad nunca produce conformidad ni deny arbitrario.
  - **Requisitos:** R5, R12, R14, R23, R27; G2–G3.

## Fase 4 — Pipeline común y predicado anti-deny

- [x] **T06. Implementar orquestador y pipeline compartido** **[CP]**
  - **Depende de:** T01–T05.
  - **Objetivo/rutas:** `src/engineering/guardrails/{orchestrator,index}.js`, `pipeline/{collect,normalize,applicability,evaluate,aggregate,exceptions}.js`.
  - [x] T06.1 Implementar flujo único `collector → normalizer → applicability → evaluator → waiver/N-A → trust gate → redactor → adapter`.
  - [x] T06.2 Aislar collectors de decisiones y E/S de evaluators; evaluators deben ser puros con reloj/datos inyectados.
  - [x] T06.3 Normalizar observaciones con schema, procedencia, revisión, scope/config/catalog hashes, confianza y limitaciones.
  - [x] T06.4 Resolver aplicabilidad antes de evaluar y abstenerse ante `unknown`, `not_applicable`, `unavailable` o conflicto.
  - [x] T06.5 Implementar `mayDeny` central exactamente como contrato de diseño; recalcularlo y no confiar en plugins/evaluators.
  - [x] T06.6 Degradar `deny` inelegible a `warn/error` con `DENY_NOT_ELIGIBLE` y evento auditable.
  - [x] T06.7 Separar findings deterministas de heurísticos; sólo los primeros participan en bloqueo.
  - [x] T06.8 Agregar resultados sin perder unidad/control/dominio ni transformar error operativo en policy deny.
  - [x] T06.9 **Validación negativa obligatoria:** regex, nombres, presencia de dependencia, AST parcial, evidencia manual no autorizada, timeout, partial, stale, conflict, cache con hash distinto, unavailable y aplicabilidad ambigua jamás producen `deny`.
  - [x] T06.10 **Validar gate:** property tests demuestran que `mayDeny` sólo es true con nivel enforce + aplicabilidad/evidencia deterministas fresh + hashes/revisión/unidad coincidentes + contrato aprobado + sin conflicto/waiver.
  - **Requisitos:** R5–R8, R12–R13, R16, R27; G3–G5.

## Fase 5 — Runtime, privacidad, evidencia y cache

- [x] **T07. Crear runtime aislado con presupuestos y cache segura** **[P]**
  - **Depende de:** T03, T06.
  - **Objetivo/rutas:** `src/engineering/guardrails/runtime/{runner,sandbox,budget,cache,temp-cleanup}.js`.
  - [x] T07.1 Ejecutar herramientas con `spawn` sin shell, cwd confinado, env allowlisted, concurrencia/memoria/timeout configurables y cleanup garantizado.
  - [x] T07.2 Definir budgets por agent/pre-commit/PR/release y fallback explícito por control.
  - [x] T07.3 Clave de cache: revisión, scope, config, catálogo, control/collector, unidad, plataforma y entradas relevantes.
  - [x] T07.4 Invalidar cache stale, corrupta o de otra identidad; cache hit no eleva confianza.
  - [x] T07.5 Probar timeout, kill de árbol de procesos, disco lleno, corrupción, carrera y offline.
  - **Requisitos:** R7, R12, R16, R20, R23, R26; G4, G7.

- [x] **T08. Implementar minimización, redacción y evidencia engineering** **[P]**
  - **Depende de:** T01, T06.
  - **Objetivo/rutas:** `src/engineering/guardrails/privacy/**`, schema/writer de evidencia, reutilización segura de `src/domain/evidence.js`.
  - [x] T08.1 Persistir sólo metadata necesaria: IDs, versiones, hashes, estados, duración, alcance agregado y referencias.
  - [x] T08.2 Prohibir código, diffs, prompts, tool inputs, queries reales, payloads, PII, tokens, URLs credencializadas y rutas absolutas.
  - [x] T08.3 Aplicar minimización antes de redacción, redacción antes de persistencia y detector final; fallo bloquea publicación del reporte.
  - [x] T08.4 Vincular evidencia a revisión/unidad/scope/config/catalog/platform y freshness.
  - [x] T08.5 Crear canarios sintéticos por cada campo prohibido y barrido global de stdout/stderr/report/cache/telemetría.
  - **Requisitos:** R7, R15–R16, R19, R21, R27; G4, G7.

## Fase 6 — CLI y lifecycle del pack

- [x] **T09. Exponer CLI engineering e instalación transaccional** **[P]**
  - **Depende de:** T03, T06–T08.
  - **Objetivo/rutas:** `src/engineering/guardrails/cli.js`, integración tipada en `src/security-cli.js` o router neutral, `install/**`, templates/schemas.
  - [ ] T09.1 Añadir `engineering install|scan|validate|audit|doctor|promote|catalog diff|uninstall` con JSON estable y modo no interactivo.
  - [ ] T09.2 Soportar `--unit`, `--control`, `--moment`, `--scope/range`, `--catalog`, `--offline`, `--dry-run`, `--format` y flags allowlisted.
  - [ ] T09.3 Definir exit codes diferenciando allow/warn, policy deny, config, tool unavailable/integrity, error interno y conflicto de migración.
  - [ ] T09.4 Instalar mediante inventario/reconciliador/transacción existente con ownership `engineering/guardrails`; no tocar config security.
  - [ ] T09.5 Implementar dry-run, idempotencia, rollback, `.kiritek-new` para conflictos y desinstalación selectiva.
  - [ ] T09.6 Probar instalación limpia/existente/parcial, doble install, fallo inyectado, rutas con espacios y coexistencia security.
  - **Requisitos:** R1, R3–R4, R13, R17, R20, R22–R23; G1–G2, G6.

## Fase 7 — Control de búsqueda

- [x] **T10. Implementar `search.input-rate` inicialmente warning-only** **[CP] [P con T11–T12]**
  - **Depende de:** T06–T08.
  - **Objetivo/rutas:** `controls/search-input-rate/{collector,normalizer,applicability,evaluator}.js`, fixtures/suite contractual.
  - [x] T10.1 Definir contrato conductual con reloj/transporte controlables y queries sintéticas opacas.
  - [x] T10.2 Recoger ráfaga, min chars, request IDs, cancel/supersede, orden de commit de resultados, equivalencias y propagación de error/cancelación.
  - [x] T10.3 Validar debounce, throttle o equivalente sin exigir librería/estrategia única.
  - [x] T10.4 Detectar requests antes de mínimo, trabajo redundante, respuestas obsoletas visibles y cancelación/supersession incorrecta.
  - [x] T10.5 Hacer que análisis AST/handlers/dependencias sólo sugiera/warn; no puede alimentar blocking findings.
  - [x] T10.6 Probar transporte cancelable/no cancelable, timers, consultas equivalentes, flake/timeout y search local con N/A gobernado.
  - [x] T10.7 **Validar gate:** en `warn` todo incumplimiento sólo avisa; suite determinista identifica fallos reproducibles y no filtra queries.
  - **Requisitos:** R8–R9, R12, R15–R16, R27; G3–G5, G7.

## Fase 8 — Control de versión mínima móvil

- [x] **T11. Implementar `app.minimum-supported-version` inicialmente warning-only** **[CP] [P con T10/T12]**
  - **Depende de:** T06–T08.
  - **Objetivo/rutas:** `controls/app-minimum-supported-version/**`, contratos/fixtures de política y stores.
  - [x] T11.1 Validar fuente/autenticidad, entorno, esquema semver, cache, timeout, hard/soft, gracia, offline, stores y observabilidad.
  - [x] T11.2 Verificar comparación menor/igual/mayor, prerelease/build metadata y payload inválido sin comparación lexicográfica.
  - [x] T11.3 Probar hard update accesible y sin loop; soft update permite continuar/postergar según frecuencia.
  - [x] T11.4 Probar offline primera ejecución, cache válida/expirada, tiempo confiable y transición de gracia.
  - [x] T11.5 Probar store ausente/enterprise, rollback sin publicar app y override autenticado, acotado, expirable, auditable y reversible.
  - [x] T11.6 Indisponibilidad remota local produce unavailable/error operativo, nunca policy deny.
  - [x] T11.7 **Validar gate:** contrato y tests son reproducibles con transporte inyectado; ningún device/account/store token queda en evidencia.
  - **Requisitos:** R8, R10, R12, R15–R16, R21, R27; G3–G5, G7.

## Fase 9 — Control de anuncios web

- [x] **T12. Implementar `web.module-announcement` inicialmente warning-only** **[CP] [P con T10–T11]**
  - **Depende de:** T06–T08.
  - **Objetivo/rutas:** `controls/web-module-announcement/**`, schema de launch manifest/anuncio y fixtures a11y.
  - [x] T12.1 Exigir señal explícita que vincule módulo con anuncio o N/A gobernado; inferencia por diff/ruta/nombre sólo warn.
  - [x] T12.2 Validar ID/versión/ventana/owner/audiencias/canales/contenido/localización/show-once/rollout/rollback.
  - [x] T12.3 Validar audiencias sin PII, canales soportados y fallback alcanzable.
  - [x] T12.4 Probar show-once/dedupe ante storage ausente o borrado y rollout pausado/retirado sin retirar módulo.
  - [x] T12.5 Probar teclado, foco, nombre/rol/estado, cierre, contraste y reduced motion según estándar configurado.
  - [x] T12.6 Probar fallback de localización y evitar claves internas, contenido vacío o markup roto.
  - [x] T12.7 **Validar gate:** sólo ausencia determinista de señal, schema inválido, N/A inválido o test contractual fallido es candidato futuro a bloqueo.
  - **Requisitos:** R8, R11–R12, R15–R16, R18, R27; G3–G5, G7.

## Fase 10 — Waivers y no aplicabilidad gobernada

- [x] **T13. Implementar waivers y N/A acotados** **[CP]**
  - **Depende de:** T06, T08, T10–T12.
  - **Objetivo/rutas:** `pipeline/exceptions.js`, schemas `waiver`/`governed-na`, auditoría asociada.
  - [x] T13.1 Exigir control, unidad, fingerprint/escenario, owner, razón, ticket, aprobador, creación, expiración y alcance.
  - [x] T13.2 Distinguir N/A de waiver; N/A requiere prueba de no aplicabilidad y waiver conserva deuda conocida.
  - [x] T13.3 Impedir comodines globales, autoaprobación cuando aplique, expiraciones excesivas y reutilización tras cambio de hashes/fingerprint.
  - [x] T13.4 Reactivar findings al expirar/cambiar alcance; mostrar deuda y próximo vencimiento sin contenido sensible.
  - [x] T13.5 Probar search local N/A, módulo no anunciable N/A y waiver temporal por control.
  - **Requisitos:** R5, R7–R8, R18, R20–R21; G4–G5.

## Fase 11 — Adaptadores y superficies

- [x] **T14. Integrar agent, Kiro, Claude, Git, CI, PR y release** **[CP]**
  - **Depende de:** T06–T13.
  - **Objetivo/rutas:** `adapters/**`, hooks/templates engineering, integración `src/integrations/{kiro,claude,ci}.js` sin duplicar reglas.
  - [x] T14.1 Agent: feedback temprano rápido; no bloquear escrituras parciales por artefactos que pueden completarse en el mismo cambio.
  - [x] T14.2 Kiro: mapear allow/warn a exit 0 y deny elegible a exit 2; no inventar `ask`.
  - [x] T14.3 Claude: usar protocolo nativo para allow/warn/ask/deny sin elevar heurísticas.
  - [x] T14.4 Git pre-commit: staged exacto, offline por defecto, sólo collectors rápidos; componer hooks idempotentemente.
  - [x] T14.5 PR: rango completo, tests contractuales y reportes provider-neutral sin reimplementar reglas en YAML.
  - [x] T14.6 Release: artefacto/config candidata, freshness y controles release-only.
  - [x] T14.7 Declarar operaciones no interceptables y cobertura posterior; no atribuir protección inexistente.
  - [x] T14.8 Probar paridad de decisión por revisión/config/catálogo, forks sin secretos, shallow history, payloads malformados y coexistencia security.
  - [x] T14.9 **Validar gate warning-only:** los tres controles corren en todas las superficies soportadas sin bloquear y con tiempos dentro de presupuesto.
  - **Requisitos:** R1, R12–R17, R23, R27; G1–G5.

## Fase 12 — Auditoría y observabilidad

- [x] **T15. Implementar auditoría por capacidades y doctor/readiness** **[CP]**
  - **Depende de:** T09–T14.
  - **Objetivo/rutas:** `audit/{capabilities,checks,report,self-check}.js`, schemas/audit y CLI.
  - [x] T15.1 Reportar por pack/unidad/control: applicable, installed, version, integrity, configured, active, executable, coverage por momento, enforcement, lastRun/result, freshness, drift y evidenceRef.
  - [x] T15.2 Distinguir ausente, off, sugerido, no aplicable, unknown, unavailable, stale, conflict, drift y verificado.
  - [x] T15.3 Self-checks usan datos sintéticos y demuestran que heurísticas no bloquean y fallos deterministas sí son elegibles.
  - [x] T15.4 `doctor/promote` verifica catálogo, config, contracts, adapters, CI/release, evidencia, waivers, budgets y suite R27.
  - [x] T15.5 Mantener auditoría engineering separada de security y ofrecer reporte multidominio sin booleano engañoso.
  - [x] T15.6 Probar archivos presentes pero desconectados/alterados/no ejecutables y evidencia de otra revisión.
  - **Requisitos:** R1, R5, R7, R12–R14, R17, R19–R21, R27; G1, G4–G6.

- [x] **T15A. Implementar telemetría minimizada opt-in** **[P]**
  - **Depende de:** T08, T15.
  - **Objetivo/rutas:** `telemetry/{events,transport}.js`.
  - [x] T15A.1 Emitir localmente IDs/versiones/estado/duración/cache/categoría de error, sin código ni datos de producto.
  - [x] T15A.2 Envío remoto sólo opt-in con TLS, auth, pseudónimo, idempotencia, timeout, anti-replay y retención.
  - [x] T15A.3 Fallo remoto conserva local pero no marca delivered; alertas agregadas no incluyen payloads.
  - [x] T15A.4 Probar off por defecto, entrega/fallo/replay y barrido anti-canario.
  - **Requisitos:** R15, R19, R21, R27; G7.

## Fase 13 — Extensibilidad y supply chain

- [x] **T15B. Implementar plugins/control packs verificables** **[P]**
  - **Depende de:** T02, T06–T08.
  - **Objetivo/rutas:** `plugins/{manifest,loader,permissions,conformance}.js`.
  - [x] T15B.1 Exigir manifest, namespace, versión/digest, compatibilidad, permisos, schemas y suite de conformidad.
  - [x] T15B.2 Aislar collectors; impedir que plugins definan `blockingEligible`, escriban fuera de temporales o accedan a red/env sin permiso.
  - [x] T15B.3 Recalcular `mayDeny` en core y degradar deny inelegible emitido por plugin.
  - [x] T15B.4 Fijar fuentes/versiones/checksums; prohibir ejecución mutable y `curl | sh`.
  - [x] T15B.5 Probar plugin malicioso, manifest inválido, digest mismatch, permisos excesivos y compatibilidad rota.
  - **Requisitos:** R4, R6–R8, R22, R25–R27; G5–G7.

## Fase 14 — Migración, compatibilidad y documentación

- [x] **T15C. Completar update/migrate/uninstall y compatibilidad** **[CP]**
  - **Depende de:** T09, T14–T15B.
  - [x] T15C.1 Reconciliar catálogo/config/hooks/templates por ownership, preservando personalizaciones y generando diff/propuesta ante conflictos.
  - [x] T15C.2 Migrar versiones anteriores reentrante e idempotentemente, con backup/rollback y sin activar nuevos gates.
  - [x] T15C.3 Soportar macOS/Linux y subconjunto Windows declarado, worktrees, monorepos, CRLF/LF, Unicode, paths con espacios, proxy/CA/offline.
  - [x] T15C.4 Desinstalar sólo artefactos engineering y conservar security/user-owned/evidencia según política.
  - [x] T15C.5 Ejecutar matriz smoke de instalación/update/migrate/uninstall y fallos inyectados.
  - **Requisitos:** R17, R20, R22–R23, R26–R27; G1–G2, G6.

- [x] **T15D. Publicar documentación y runbooks** **[P]**
  - **Depende de:** T09–T15C.
  - [x] T15D.1 Documentar arquitectura, límites security/engineering, config, catálogo, perfiles, controles, momentos y estados de auditoría.
  - [x] T15D.2 Guías para repo nuevo/existente, monorepo, offline, CI, agent, rollout, rollback, update y uninstall.
  - [x] T15D.3 Runbooks para falso positivo, flaky test, tool unavailable, evidence stale/conflict, waiver/N/A, hard-update defectuoso y anuncio inaccesible.
  - [x] T15D.4 Catálogo de remediaciones con ejemplos framework-neutral y advertencia de que heurísticas nunca bloquean.
  - **Requisitos:** R20, R24, R26–R27; G6.

## Fase 15 — Suite de conformidad y promoción

- [x] **T16. Demostrar R27 y habilitar promoción controlada** **[CP]**
  - **Depende de:** T10–T15D.
  - **Objetivo:** suite final unitaria, property, contract, integración, privacidad, performance, multiplataforma y smoke.
  - [x] T16.1 Ejecutar suites contractuales completas de los tres controles en warn con fixtures positivos/negativos/borde.
  - [x] T16.2 Property/fuzz de schemas, paths, config precedence, monorepo scope, cache identity, waivers y `mayDeny`.
  - [x] T16.3 Pruebas negativas exhaustivas: regex, AST parcial, nombre/ruta/dependencia, timeout, stale, conflict, unavailable, partial, mismatch y perfil sugerido jamás bloquean como policy deny.
  - [x] T16.4 Probar que un fallo determinista fresh atribuible sí genera `deny` sólo tras promoción explícita y contrato aprobado.
  - [x] T16.5 Comparar warn/enforce: mismos collectors, alcance y findings; sólo cambia la decisión elegible.
  - [x] T16.6 Medir budgets agent/pre-commit/PR/release y registrar degradación sin omitir silenciosamente.
  - [x] T16.7 Barrer stdout/stderr/reportes/cache/evidencia/telemetría para queries, payloads, prompts, PII y canarios.
  - [x] T16.8 Ejecutar matrix macOS/Linux/Windows declarada y skips sólo con razón.
  - [x] T16.9 `doctor` debe negar promoción si falta cualquier requisito de readiness, CI/release coverage, evidencia, integridad o suite R27.
  - [x] T16.10 Promover individualmente por unidad/control; registrar actor/origen/fecha/config anterior/nueva/evidencia y permitir rollback inmediato.
  - **Requisitos:** R7–R13, R16, R19–R23, R26–R27; G1–G7.

## Fase 16 — Gate de release de la iniciativa

- [ ] **T17. Cerrar aceptación global y publicar el pack** **[CP]**
  - **Depende de:** T16.
  - [x] T17.1 Confirmar instalación idempotente y aislamiento total respecto de security.
  - [x] T17.2 Confirmar resolución reproducible de perfiles/unidades/catálogo/config y cobertura monorepo.
  - [x] T17.3 Confirmar que los tres controles detectan sus fallos conductuales sin imponer librerías o frameworks.
  - [x] T17.4 Confirmar que no existe ninguna ruta heurística hacia policy deny.
  - [x] T17.5 Confirmar auditoría honesta, evidence freshness, waivers/N/A gobernados y rollback.
  - [ ] T17.6 Confirmar privacidad, supply chain, compatibilidad y documentación operativa.
  - [ ] T17.7 Publicar catálogo/versionado/changelog/migración/procedencia y evidencia de la suite completa.
  - **Gate final:** todos los criterios globales G1–G7 y R27 deben estar demostrados antes de declarar disponibilidad general.
  - **Estado (2026-10-13):** gate implementado (`kiritek-init/scripts/release-gate.js`, `kiritek-init/release/gate/`), resultado `blocked`. T17.1–T17.5 en verde. T17.6 espera la matriz CI (Linux 18/20/22, Windows 22). T17.7 espera la suite completa del repo en verde (37.3 de security, fuera de engineering), un árbol commiteado y `--approve`. Por R27.7 el pack sigue warning-only: el catálogo 2.0.0 queda como candidato y `approved.json` vacío.
  - **Requisitos:** R1–R27; G1–G7.

## Matriz de trazabilidad resumida

| Área | Requisitos | Tareas principales |
|---|---|---|
| Separación y contratos | R1, R5–R8 | T01, T06 |
| Perfiles/config/catálogo | R2–R4 | T02–T04 |
| Monorepo y superficies | R12–R14 | T05, T14 |
| Búsqueda | R9 | T10 |
| Versión mínima móvil | R10 | T11 |
| Anuncios web | R11 | T12 |
| Privacidad/evidencia | R7, R15–R16 | T08, T15A |
| Lifecycle/CI/auditoría | R13, R17, R19–R21 | T09, T14–T15C |
| Waivers/N/A | R18 | T13 |
| Extensibilidad/supply chain | R22, R25 | T02, T15B |
| Compatibilidad/documentación | R23–R24, R26 | T15C–T15D |
| Conformidad y enforcement | R27 | T16–T17 |

## Criterio de finalización

La iniciativa no se considera terminada porque los archivos existan o las pruebas unitarias pasen. Finaliza únicamente cuando T17 demuestra que: la aplicabilidad es explícita; los resultados son reproducibles; los tres controles funcionan mediante evidencia conductual/contractual; cualquier señal heurística se limita a warning; los errores operativos no se presentan como incumplimientos; la privacidad está comprobada; y la promoción a enforcement es explícita, granular, auditable y reversible.
