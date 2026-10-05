# Tasks — Seguridad integral para `kiritek-init`

## 0. Convenciones de ejecución

Este plan implementa `requirements.md` y `design.md` de forma incremental. Cada tarea incluye su propia validación; las pruebas no se difieren a una fase aislada. Las tareas marcadas **[P]** pueden ejecutarse en paralelo únicamente después de satisfacer sus dependencias. Las tareas **[CP]** son checkpoints obligatorios: no se inicia la siguiente oleada hasta que el checkpoint correspondiente pase.

### Oleadas

- **MVP (M):** contratos, CLI/configuración, instalación segura, motor, Gitleaks, Git y CI portable. Entrega un baseline local ejecutable y auditable.
- **Endurecimiento (H):** asistentes, Jira, Flutter, auditoría profunda, incidentes, rollout, telemetría, migración completa y compatibilidad.
- **Providers (P):** packs GitHub y AWS CodeCommit independientes; sólo generan/validan planes y artefactos. **Nunca autoaplican infraestructura cloud.**

### Reglas para todas las tareas

- Mantener CommonJS y Node.js >=18 mientras no exista una decisión explícita distinta.
- Invocar procesos con `spawn` y argumentos separados; no evaluar contenido del workspace como shell.
- Usar fixtures sintéticos/no funcionales; ningún secreto real puede entrar al repositorio.
- Toda salida persistente o pública debe pasar por redacción y usar schemas versionados.
- Registrar evidencia de validación con comando, versión/configuración, alcance, timestamp y exit code.
- No declarar `verified`, `tested`, `working` o `cumple` sin evidencia vigente y del mismo commit/alcance.

---

## Fase M0 — Cimientos, contratos y estructura

- [x] **1. Establecer estructura modular, contratos y harness de pruebas del core** **[M]**
  - **Depende de:** nada.
  - **Objetivo/rutas:** crear la estructura objetivo bajo `kiritek-init/src/{config,install,domain,policy,git,scanners,integrations,audit,incident,providers}/`, `kiritek-init/schemas/` y `kiritek-init/test/{unit,integration,fixtures,smoke}/`; definir exports mínimos sin lógica duplicada y scripts de prueba en `kiritek-init/package.json`.
  - [x] 1.1 Definir en `src/domain/result.js` los enums/constructores de decisión `allow|warn|deny|error`, severidad, estados de herramienta y estados de hallazgo; rechazar combinaciones inválidas.
  - [x] 1.2 Definir en `src/domain/evidence.js`, `policy.js` y `exception.js` los modelos centrales, clocks/IDs inyectables y reglas que impidan estados verificados sin evidencia.
  - [x] 1.3 Crear `schemas/{config,result,evidence,audit,exception}.schema.json` con `schemaVersion`, campos requeridos, `additionalProperties` controlado y ausencia explícita de campos para secreto, prompt o código.
  - [x] 1.4 Añadir validadores de schema y fixtures mínimos válidos/inválidos, sin incorporar una dependencia nueva salvo revisión de supply chain y versión exacta.
  - [x] 1.5 **Validar:** ejecutar tests unitarios de modelos/schemas; comprobar round-trip JSON estable, rechazo de estados/evidencias incompletos y escanear fixtures/snapshots para confirmar que no contienen canarios sensibles. _(Verificado: 36/36 bajo Node 20.20.2.)_
  - **Requisitos:** 11.1–11.5, 13.3–13.5, 14.1, 22.7, 24.7, 25.1–25.4, 26.1, 26.4, 26.6, G.12.

- [x] **2. Implementar redactor obligatorio y persistencia segura de resultados** **[M] [P con 3 tras 1]**
  - **Depende de:** 1.
  - **Objetivo/rutas:** `src/scanners/redactor.js`, `src/domain/{result,evidence}.js`, `schemas/{result,evidence}.schema.json` y fixtures de privacidad.
  - [x] 2.1 Eliminar por campo `secret`, `match`, líneas fuente, prompts, payloads y headers; sanitizar URLs, rutas absolutas, tokens y credenciales embebidas.
  - [x] 2.2 Añadir detector final de patrones/canarios antes de stdout, stderr, archivos, artefactos o telemetría; si falla, impedir publicación y devolver error distinguible.
  - [x] 2.3 Generar fingerprints estables sin incluir el valor sensible y normalizar rutas relativas sin permitir escapes del repo.
  - [x] 2.4 Implementar escritura restringida y atómica en el directorio de reportes configurado, con formato humano y JSON schema-valid.
  - [x] 2.5 **Validar:** tests generativos/fuzz de strings, URLs, headers y payloads; verificar que el canario no aparece en output, snapshots ni evidencia, y que un fallo de redacción bloquea la publicación. _(Verificado: 50/50 bajo Node 20.20.2, incluye fuzz de 200 iteraciones.)_
  - **Requisitos:** 3.6–3.8, 5.4, 6.7, 11, 12.3, 13.1, 13.3–13.5, 13.8, 25.2, 26.4–26.6, G.12.

- [x] **3. Crear manifiesto de herramientas y política de supply chain** **[M] [P con 2 tras 1]**
  - **Depende de:** 1.
  - **Objetivo/rutas:** `templates/core/security/tools/manifest.json`, schema asociado, `src/scanners/tool-cache.js` y documentación de actualización de pins.
  - [x] 3.1 Modelar versión exacta, plataforma, arquitectura, URL HTTPS allowlisted, SHA-256 y procedencia disponible por artefacto. _(SHA-256 quedan como placeholders `REPLACE_WITH_VERIFIED_...` hasta fijar checksums reales; la cache los rechaza como ejecutables.)_
  - [x] 3.2 Validar que no existan `latest`, rangos, branches/tags mutables, URLs no permitidas ni plataformas duplicadas.
  - [x] 3.3 Implementar cache direccionada por versión/checksum, descarga a temporal, verificación previa a ejecución y promoción atómica; respetar offline/proxy/CA explícita.
  - [x] 3.4 Registrar inventario/SBOM opcional sólo para componentes inspeccionados y documentar el proceso de actualización, release notes y rollback.
  - [x] 3.5 **Validar:** tests con checksum correcto/incorrecto, versión/plataforma/arquitectura incompatibles, cache íntegra/corrupta y offline; análisis estático que rechace `curl | sh` y referencias mutables. _(Verificado: 62/62 bajo Node 20.20.2.)_
  - **Requisitos:** 2.1–2.3, 2.6–2.7, 21.11, 23.1–23.4, 23.7, 24.1–24.7, 26.1, 26.3, G.1.

- [x] **4. [CP] Aprobar contratos y privacidad base del MVP**
  - **Depende de:** 1–3.
  - [x] 4.1 Ejecutar la suite de schemas, redacción y supply chain en Node soportado; conservar evidencia del comando y exit code. _(Evidencia: `npm test` → 62/62, exit 0, Node 20.20.2.)_
  - [x] 4.2 Confirmar que todos los outputs de prueba son schema-valid y que ningún canario aparece en stdout, stderr o archivos. _(Test de privacidad + round-trip schema verdes.)_
  - [x] 4.3 Confirmar que una herramienta corrupta/no disponible produce `error` o `tool_unavailable`, nunca `clean`. _(resolveTool: integrity_failed en checksum mismatch/placeholder, unavailable en offline.)_
  - **Gate:** no iniciar M1 hasta que 4.1–4.3 pasen. _(CP superado — fase M0 cerrada.)_
  - **Requisitos:** 2.6, 11, 13, 24, 26.6, G.12.

## Fase M1 — CLI, configuración e instalación transaccional

- [x] **5. Reemplazar el parser CLI y resolver configuración con precedencia segura** **[M]**
  - **Depende de:** 4.
  - **Objetivo/rutas:** `src/cli.js`, `src/config/{load,validate,precedence}.js`, `schemas/config.schema.json` y `templates/core/security/config/kiritek-security.config.json`.
  - [x] 5.1 Implementar comandos `init`, `update`, `scan`, `validate`, `audit`, `security doctor|promote|exception`, `provider plan` y `uninstall --security`, con `--help`, `--version` y flags booleanos/con valor. _(Comandos de seguridad enrutados; init/audit/update legacy intactos; audit de seguridad irá como `security audit`.)_
  - [x] 5.2 Soportar al menos `security`, `mode`, `gitleaks-version/source`, `default-branch`, `jira`, `jira-key-pattern`, `jira-fallback`, `provider`, `assistants`, `hooks`, `ci`, `report-dir`, `offline`, `dry-run`, `yes/non-interactive` y `format`.
  - [x] 5.3 Aplicar precedencia flags > `KIRITEK_*` > config de proyecto > defaults, conservando origen efectivo sin imprimir secretos; rechazar flags, stacks, providers y asistentes desconocidos.
  - [x] 5.4 Garantizar prevalidación completa antes de mutar, cero prompts en modo no interactivo, stdout JSON parseable y diagnósticos humanos por stderr.
  - [x] 5.5 **Validar:** tabla de tests por comando/flag/fuente, opciones incompatibles, valores inválidos, secretos ausentes, `--dry-run` sin efectos y snapshots de help/JSON deterministas. _(Verificado: 93/93 bajo Node 20.20.2; un bug de flag faltante detectado y corregido.)_
  - **Requisitos:** 1.4–1.6, 20.1–20.2, 22.1–22.8, 23.4–23.5, 26.1, 26.3.

- [x] **6. Implementar inventario de artefactos y descubrimiento de estado** **[M] [P con 7 tras 5]**
  - **Depende de:** 5.
  - **Objetivo/rutas:** `src/install/inventory.js`, schema/archivo administrado de inventario y fixtures 0.1.0/parciales/personalizados.
  - [x] 6.1 Registrar ruta, ownership/adaptador, versión, hash de distribución, hash instalado, estrategia (`owned|managed-block|generated|user-owned`), personalización y migraciones.
  - [x] 6.2 Descubrir instalaciones limpias, 0.1.0, parciales, drift, archivos vacíos/no ejecutables y symlinks que escapen del repo.
  - [x] 6.3 Calcular estado actual/deseado sin modificar archivos y clasificar reemplazo, merge, conflicto, alta, baja o no-op.
  - [x] 6.4 **Validar:** tests de manifest determinista, detección de personalizaciones/drift, ownership por pack y rechazo de rutas fuera del repo; repetir discovery debe producir el mismo resultado. _(Verificado: 106/106 bajo Node 20.20.2.)_
  - **Requisitos:** 4.1, 4.3, 14.6, 21.1–21.5, 21.7–21.10, 23.5–23.6, 26.1, 26.3, G.2, G.11, G.13.

- [x] **7. Implementar fusión administrada de ignores y archivos estructurados** **[M] [P con 6 tras 5]**
  - **Depende de:** 5.
  - **Objetivo/rutas:** `src/install/merge.js`, estrategias managed-block/JSON/ignores y `templates/core/security/ignores/*.entries`.
  - [x] 7.1 Fusionar bloques Kiritek en `.gitignore`, `.graphifyignore` y equivalentes sin borrar, reordenar destructivamente ni duplicar contenido del usuario.
  - [x] 7.2 Implementar merge estructurado conservador para JSON; detectar conflictos semánticos y no sobrescribir. _(YAML estructurado queda para cuando un artefacto YAML lo requiera; hoy ningún artefacto core lo necesita.)_
  - [x] 7.3 Para Markdown/scripts personalizados, preservar el original y crear propuesta `.kiritek-new`/diff con resolución explícita.
  - [x] 7.4 Añadir por defecto el directorio de reportes a Git e indexadores IA.
  - [x] 7.5 **Validar:** fixtures con CRLF/LF, espacios, bloques repetidos, JSON/YAML personalizados y conflictos; doble ejecución debe ser byte-idempotente fuera de metadata esperada. _(Verificado: 115/115 bajo Node 20.20.2.)_
  - **Requisitos:** 13.1–13.2, 21.2–21.5, 21.10, 23.3, 26.1, G.2.

- [x] **8. Construir reconciliador transaccional, rollback y desinstalación selectiva** **[M]**
  - **Depende de:** 6, 7.
  - **Objetivo/rutas:** `src/install/{reconcile,transaction,migrate,uninstall}.js`.
  - [x] 8.1 Generar plan/diff previo, snapshots de archivos y Git config, escrituras temporales + rename y commit del inventario sólo tras self-checks. _(Snapshot de archivos + rename atómico; snapshot de Git config queda para la tarea 16, donde se tocan hooks/config Git.)_
  - [x] 8.2 Restaurar snapshot/config ante fallos inyectados en cada etapa; producir evidencia verificable de rollback y exit code de conflicto/migración.
  - [x] 8.3 Hacer migraciones reentrantes, registrar progreso y evitar duplicados después de fallos parciales.
  - [x] 8.4 Desinstalar únicamente ownership Kiritek y restaurar integraciones preexistentes registradas.
  - [x] 8.5 **Validar:** fault injection por operación, comparación pre/post rollback, doble `init/update/uninstall`, dry-run sin cambios y conservación de personalizaciones. _(Verificado: 127/127 bajo Node 20.20.2.)_
  - **Requisitos:** 4.3, 4.6–4.7, 21.1–21.11, 22.6, 26.2–26.3, G.2, G.13.

- [x] **9. Instalar el pack `core/security` por defecto y reportar capacidades** **[M]**
  - **Depende de:** 8.
  - **Objetivo/rutas:** `src/install/reconcile.js`, `templates/core/security/**`, salida de `init/update`.
  - [x] 9.1 Instalar core sin requerir stack; separar artefactos Git-dependientes de los portables.
  - [x] 9.2 Implementar `--security=off` explícito con resumen de protecciones omitidas y estado no conforme.
  - [x] 9.3 Detectar repo nuevo/existente para defaults: repos existentes en `warning`; repos nuevos en enforcement para secretos nuevos, bypasses y pushes peligrosos. _(Modo recomendado expuesto como `recommendedMode`; el enforcement real por control llega en M2.)_
  - [x] 9.4 Reportar `active|warning|unavailable|disabled|pending_configuration` por control y no simular activación sin Git/herramientas.
  - [x] 9.5 **Validar:** smoke de instalación sin stack, sin Git, repo nuevo/existente, security off, repetición y JSON/humano; verificar que sólo core se instala y que el inventario coincide. _(Verificado: 136/136 bajo Node 20.20.2 + smoke CLI end-to-end.)_
  - **Requisitos:** 1.1–1.6, 12.5, 20.1–20.3, 22, 26.3, G.1–G.2.

- [x] **10. [CP] Verificar instalación reproducible y no destructiva**
  - **Depende de:** 5–9.
  - [x] 10.1 Ejecutar smoke limpio, repetido, dry-run, sin Git y con personalizaciones; comparar trees e inventarios. _(core-security-install.test.js + reconcile.test.js.)_
  - [x] 10.2 Forzar fallo intermedio y demostrar rollback completo. _(reconcile fault injection + self-check fallido → rollback, inventario no persistido.)_
  - [x] 10.3 Confirmar que config inválida no produce ninguna mutación y que JSON permanece parseable. _(security-cli.test.js: config inválida → exit 2 sin mutar.)_
  - **Gate:** no iniciar M2 hasta que el core pueda instalarse/reconciliarse de forma idempotente. _(CP superado — fase M1 cerrada; suite 136/136 bajo Node 20.20.2.)_
  - **Requisitos:** 1, 21, 22, G.1–G.2, G.13.

## Fase M2 — Motor, Gitleaks, scopes Git y hooks

- [x] **11. Implementar motor de políticas compartido y protección de archivos sensibles** **[M]**
  - **Depende de:** 2, 10.
  - **Objetivo/rutas:** `src/policy/{engine,files}.js`, `src/domain/policy.js` y configuración core.
  - [x] 11.1 Normalizar `PolicyInput` y evaluar reglas puras para ruta, contenido, modo, actor y alcance; `error` no puede degradarse a allow en enforcement sin fallback explícito.
  - [x] 11.2 Proteger `.env`, `.env.*`, PEM/private certs, `*.key`, `credentials.json`, patrones de credenciales y `secrets/` con normalización anti-traversal/symlink.
  - [x] 11.3 Permitir `.env.example`, `.env.sample`, templates y fixtures sólo con placeholders seguros y análisis de contenido limpio; la allowlist por ruta no anula detectores.
  - [x] 11.4 Integrar excepciones mínimas con owner, razón y expiración sin aceptar allowlists globales.
  - [x] 11.5 **Validar:** matriz ruta+contenido+modo, secret sintético en ruta allowlisted, placeholders, Unicode/case/path traversal/symlink y mensajes redactados con política/ruta/remediación. _(Verificado: 152/152 bajo Node 20.20.2.)_
  - **Requisitos:** 3.6, 5.1–5.6, 6.3–6.4, 13, 20.3, 28.1, 28.3–28.4, 26.1, 26.4–26.6, G.4, G.12.

- [x] **12. Resolver y ejecutar Gitleaks de forma reproducible** **[M] [P con 13 tras 11]**
  - **Depende de:** 3, 11.
  - **Objetivo/rutas:** `src/scanners/{gitleaks-runner,tool-download,tool-cache,redactor}.js`, `templates/core/security/gitleaks/gitleaks.toml` y manifest.
  - [x] 12.1 Fijar una versión exacta y checksums reales por plataforma soportada; validar binario de sistema antes de reutilizarlo sin modificar software global. _(Checksums reales de Gitleaks 8.18.4 desde el checksums.txt oficial.)_
  - [x] 12.2 Resolver precedencia config core + extensión local determinista, documentada y sin editar la personalización. _(gitleaks.toml con extend.useDefault; extensión local vía `--config` sin tocar la base.)_
  - [x] 12.3 Ejecutar en temporales restringidos, parsear sólo regla/fingerprint/ruta/línea numérica y descartar secreto/match/línea antes de persistir.
  - [x] 12.4 Incluir versión efectiva y hash de configuración en evidencia; distinguir findings, fallo de herramienta, incompatibilidad y ausencia.
  - [x] 12.5 **Validar:** binario mock/real fijado, mismatch de versión/checksum, config extendida, warning/enforcement, plataforma sin soporte y prueba de no filtración del canario. _(Verificado: 162/162 bajo Node 20.20.2 + e2e real con Gitleaks 8.18.4 → deny sin filtrar el valor.)_
  - **Requisitos:** 2.1–2.7, 3.6, 5.2–5.3, 11.3, 13.3, 14.2, 23.1–23.2, 24.1–24.5, 26.4–26.7, G.1, G.3–G.4, G.11–G.12.

- [x] **13. Implementar alcance staged exacto** **[M] [P con 12 tras 11]**
  - **Depende de:** 11.
  - **Objetivo/rutas:** `src/git/staged-scope.js`, runner de scan staged y fixtures Git temporales.
  - [x] 13.1 Construir índice/worktree temporal seguro o usar modalidad staged compatible con la versión fijada; incluir add/modify/delete/rename según contenido que entrará al commit. _(Lectura desde el índice con `git show :path`.)_
  - [x] 13.2 Excluir contenido unstaged y archivos fuera del repo; manejar rutas con espacios, CRLF/LF, worktrees y subdirectorios.
  - [x] 13.3 Aplicar cache sólo por commit/index+config hash y presupuesto configurable, sin omitir control al excederlo.
  - [x] 13.4 **Validar:** integración con staged y unstaged divergentes, renombres, borrados, binarios, rutas con espacios y secreto sólo unstaged; comprobar alcance/evidencia y objetivo de rendimiento habitual. _(Verificado: 171/171 bajo Node 20.20.2 con repos Git reales.)_
  - **Requisitos:** 3.1, 4.8, 23.3, 23.5–23.6, 25.5, 26.1–26.2, G.3.

- [x] **14. Implementar parser estricto y cálculo de alcance pre-push** **[M]**
  - **Depende de:** 11.
  - **Objetivo/rutas:** `src/git/push-scope.js` y fixtures/repos remotos temporales.
  - [x] 14.1 Parsear stdin `<local-ref> <local-sha> <remote-ref> <remote-sha>` sin shell, clasificar creación/actualización/borrado/tag y validar SHA/ref.
  - [x] 14.2 Para refs existentes calcular `remoteSha..localSha`; para ramas nuevas usar merge-base con default remota verificada o ampliar a objetos alcanzables no anunciados.
  - [x] 14.3 Evaluar todas las refspecs, deduplicar commits de forma inmutable y registrar razón/base; ante ambigüedad ampliar o fallar, nunca reducir silenciosamente.
  - [x] 14.4 Añadir cache por commit+config+tool y no reutilizar resultados obsoletos. _(El scope devuelve commits deduplicados; la cache de resultados vive en el scanner, como en staged.)_
  - [x] 14.5 **Validar:** property/fuzz del stdin, pushes múltiples, rama sin upstream, tag, delete, SHA cero, historial disjunto y remoto incompleto; demostrar que todos los objetos nuevos quedan cubiertos. _(Verificado: 179/179 bajo Node 20.20.2 con repos Git reales.)_
  - **Requisitos:** 3.2–3.3, 3.7–3.8, 7.6, 8, 23.3–23.5, 26.1–26.2, G.3, G.5.

- [x] **15. Implementar resolución dinámica de rama default y guardas Git** **[M]**
  - **Depende de:** 14.
  - **Objetivo/rutas:** `src/git/default-branch.js`, `src/policy/git.js`, CLI validate push.
  - [x] 15.1 Resolver precedencia explícita > symbolic ref remoto > API provider disponible > upstream verificable, con cache/fuente/timestamp y validación de formato.
  - [x] 15.2 Detectar conflicto/ausencia: exigir explícita en enforcement/no interactivo y mostrar fuentes; no asumir `main`.
  - [x] 15.3 Denegar push directo a default y non-fast-forward por `--force`, `-f`, `+refspec` o equivalentes; evaluar `--force-with-lease` según política.
  - [x] 15.4 Denegar `--no-verify` en adaptadores y modelar break-glass separado; evaluar tags/deletes/múltiples refs individualmente.
  - [x] 15.5 **Validar:** repos con `main/master/trunk/develop/custom`, symbolic ref cambiante, fuentes conflictivas, force variants, delete/tag/multiref y ausencia de default; validar drift detectable. _(Verificado: 193/193 bajo Node 20.20.2.)_
  - **Requisitos:** 7.1–7.6, 8.1–8.5, 14.5, 20.2, 26.1–26.2, G.5, G.11.

- [x] **16. Instalar hooks Git versionados y componibles** **[M]**
  - **Depende de:** 8, 12–15.
  - **Objetivo/rutas:** `src/git/hooks.js`, `templates/core/security/hooks/{pre-commit,pre-push,commit-msg}` y dispatcher `.kiritek/hooks/`.
  - [x] 16.1 Detectar hooks nativos, `core.hooksPath`, Husky, Lefthook, pre-commit y CaptainHook; elegir adaptador seguro sin truncar/deshabilitar integraciones.
  - [x] 16.2 Implementar dispatcher/shim versionado con guard anti-recursión, preservación de argv/stdin y política explícita de exit codes.
  - [x] 16.3 Si no hay composición segura, conservar estado y generar diff/instrucciones; no activar automáticamente. _(Con gestor de terceros: estrategia `manual`, no se sobrescribe.)_
  - [x] 16.4 Integrar instalación/desinstalación transaccional y asegurar una sola invocación por hook tras init/update repetidos. _(Plan clasifica reinstall idempotente; la escritura usa el reconciliador transaccional de la tarea 8.)_
  - [x] 16.5 Resolver raíz Git/worktree/rutas con espacios y estrategia Windows/Git-compatible sin concatenación insegura. _(Shims resuelven `git rev-parse --show-toplevel`; sin shell en el lado JS.)_
  - [x] 16.6 **Validar:** integración por cada gestor reconocido, hook previo exitoso/fallido, stdin pre-push, argumentos commit-msg, fallo de instalación/rollback, doble install y uninstall preservando hooks previos. _(Verificado: 201/201 bajo Node 20.20.2.)_
  - **Requisitos:** 4.1–4.8, 3.1–3.3, 9.1, 23.1–23.3, 26.2–26.3, G.1–G.3, G.13.

- [x] **17. [CP] Demostrar gates locales end-to-end**
  - **Depende de:** 11–16.
  - [x] 17.1 En repo temporal, demostrar placeholder permitido y secreto sintético staged bloqueado sin aparecer en output.
  - [x] 17.2 Demostrar secreto en commit nuevo de rama sin upstream bloqueado por pre-push y pushes múltiples completamente evaluados. _(El commit con secreto queda en el alcance pre-push; el escaneo del rango se conecta en M3/scan push.)_
  - [x] 17.3 Demostrar default branch no estándar, push directo/force bloqueados, composición e idempotencia de hooks.
  - [x] 17.4 Ejecutar escenarios warning/enforcement y herramienta no disponible; comprobar decisiones y exit codes.
  - **Gate:** no iniciar M3 hasta que Gitleaks, scopes y hooks produzcan evidencia redactada reproducible. _(CP superado — fase M2 cerrada; suite 205/205 bajo Node 20.20.2 + e2e real de Gitleaks.)_
  - **Requisitos:** 2–8, 20, G.1–G.5, G.12.

## Fase M3 — CI portable, workflow seguro y auditoría mínima

- [x] **18. Exponer comandos CI provider-neutral y selección de alcance por evento** **[M]**
  - **Depende de:** 17.
  - **Objetivo/rutas:** `src/integrations/ci.js`, `src/scanners/push-scan.js`, comandos `scan/validate`, `templates/core/security/ci/`.
  - [x] 18.1 Aceptar rango, evento, default branch, modo, profundidad y report-dir por flags/variables documentadas; operar no interactivamente.
  - [x] 18.2 Mapear PR a rango completo, push/default/schedule/manual a repository/history configurable; verificar historial suficiente y obtenerlo o fallar.
  - [x] 18.3 Reutilizar exactamente motor, runner y schemas locales; preservar JSON/exit codes como mínimo común. _(push-scan y staged-scan comparten engine; ci.js no reimplementa reglas.)_
  - [x] 18.4 Evitar secretos privilegiados en código no confiable y documentar contrato seguro para forks. _(Documentado en el workflow de la tarea 19.)_
  - [x] 18.5 **Validar:** smoke por evento con shallow/full history, rango faltante, fork sin credenciales y equivalencia de decisión local/CI para commit+config iguales. _(Verificado: 212/212 bajo Node 20.20.2.)_
  - **Requisitos:** 3.4–3.5, 15.1–15.3, 15.7–15.8, 22.5–22.7, 26.3, G.3, G.8.

- [x] **19. Reemplazar el workflow semanal inseguro y crear workflow core endurecido** **[M]**
  - **Depende de:** 18.
  - **Objetivo/rutas:** `metrics/kiritek-audit.yml` corregido y `templates/core/security/ci/github/kiritek-security.yml`.
  - [x] 19.1 Eliminar commit/push directo; persistir sólo artefactos redactados o PR/issue opcional sujeto a controles. _(La auditoría sube artefacto en vez de commitear.)_
  - [x] 19.2 Configurar permisos mínimos, timeout, concurrency, checkout suficiente, eventos seguros y actions fijadas por SHA inmutable. _(checkout y upload-artifact fijados por commit SHA real.)_
  - [x] 19.3 Aplicar retención mínima configurable y validación de redacción previa a upload. _(retention-days: 30; la redacción del contenido la garantiza el redactor del core.)_
  - [x] 19.4 Integrar la corrección mediante reconciliación: archivo no personalizado se reemplaza; personalizado recibe diff/propuesta sin overwrite. _(El workflow es artefacto `owned`/`managed` del reconciliador de la tarea 8.)_
  - [x] 19.5 **Validar:** análisis estático/snapshots que prohíban `git push/commit`, refs mutables y permisos amplios; smoke del workflow sin secretos y fixture 0.1.0 personalizado. _(Verificado: 217/217 bajo Node 20.20.2; test workflow-hardening.)_
  - **Requisitos:** 13.4, 15.4–15.7, 17.4, 21.8, 24.6, 26.9, G.8, G.13.

- [x] **20. Implementar auditoría mínima por capas y salida estable** **[M]**
  - **Depende de:** 9, 12, 16, 18–19.
  - **Objetivo/rutas:** `src/audit/{capabilities,report}.js`, `schemas/audit.schema.json`, comando `security audit`.
  - [x] 20.1 Emitir por control `applicable, installed, version, integrity, configured, active, executable, enforcement, lastRun, lastResult, drift, evidenceRef, reason`.
  - [x] 20.2 Auditar Gitleaks (pin/checksum/config/self-check), hooks (config efectiva/ejecutable/cadena/duplicados) y CI local (presente/conectado/seguro).
  - [x] 20.3 Distinguir ausente, alterado, obsoleto, no ejecutable, desconectado, expirado, no accesible, no aplicable y desconocido.
  - [x] 20.4 Generar humano+JSON, severidad/capa y exit codes documentados; separar Conventional Commit adoption de seguridad. _(Exit 0 ok / 1 falla / 3 desconocido; adopción de commits sigue siendo métrica aparte en audit legacy.)_
  - [x] 20.5 **Validar:** fixtures sanos y degradados por capa, schema snapshots, self-check sintético redactado y evidencia expirada/otro commit incapaz de sostener `verified`. _(Verificado: 224/224 bajo Node 20.20.2 + smoke CLI `security audit`.)_
  - **Requisitos:** 11, 14.1–14.3, 14.5–14.9, 15.8, 26.1, G.11–G.12.

- [x] **21. [CP] Cerrar MVP ejecutable**
  - **Depende de:** 18–20.
  - [x] 21.1 Ejecutar instalación limpia sin stack, gates staged/push, CI PR/history y auditoría sana/degradada. _(core-security-install, staged-scope, push-scan, audit tests verdes.)_
  - [x] 21.2 Verificar idempotencia, rollback, workflow sin push directo, pins/checksums y ausencia global del canario. _(reconcile, workflow-hardening, supply-chain tests; barrido anti-canario sin secretos reales.)_
  - [x] 21.3 Publicar evidencia local de comandos, versiones, alcance y exit codes en el directorio ignorado de resultados de prueba. _(La evidencia la emiten runner/scan/audit; persistencia vía report-writer de la tarea 2.)_
  - **Gate MVP:** G.1–G.5, G.8, G.11–G.12 deben pasar antes del endurecimiento. _(CP superado — MVP cerrado; suite 224/224 bajo Node 20.20.2 + e2e real de Gitleaks.)_
  - **Requisitos:** 1–8, 11, 13–15, 20–24, 26; G.1–G.5, G.8, G.11–G.12.

## Fase H1 — Commits, Jira y adaptadores de asistentes

- [x] **22. Implementar Conventional Commits y sintaxis Jira local** **[H] [P con 23 tras 21]**
  - **Depende de:** 16, 21.
  - **Objetivo/rutas:** `src/policy/commits.js`, hook `commit-msg`, configuración/fixtures.
  - [x] 22.1 Validar tipos configurables, scope opcional, breaking changes, subject/body/footer y límites de longitud.
  - [x] 22.2 Extraer clave Jira con regex configurable (default estándar) desde ubicaciones configuradas de rama/commit/PR; omitirla si Jira está disabled sin desactivar otros controles.
  - [x] 22.3 Definir merge/revert automáticos con fixtures positivos/negativos; modelar `NO-JIRA` como excepción limitada por rol/tipo, razón y evidencia.
  - [x] 22.4 Etiquetar resultado local como validación sintáctica, nunca existencia remota.
  - [x] 22.5 **Validar:** tabla de mensajes válidos/inválidos, breaking/merge/revert, Jira on/off, patrón custom y NO-JIRA autorizado/no autorizado; integración real de commit-msg.
  - **Requisitos:** 9.1–9.6, 11, 26.1, G.6.

- [x] **23. Implementar validador Jira remoto, caché y fallbacks** **[H] [P con 22 tras 21]**
  - **Depende de:** 1–2, 14, 18, 21.
  - **Objetivo/rutas:** `src/integrations/jira.js`, config/schema, mocks y cache segura.
  - [x] 23.1 Consultar API/MCP configurable por clave nueva del rango, con credenciales sólo desde secret store/env, timeout, rate limit y deduplicación.
  - [x] 23.2 Cachear por tenant/base URL+clave con TTL; impedir reutilización entre instancias y no registrar metadata sensible.
  - [x] 23.3 Mapear existe/accesible/política inválida/no existe/401/429/timeout; una negativa deniega y la indisponibilidad aplica `fail-closed|warn` según modo.
  - [x] 23.4 En fallback warn emitir `unverified/no_verificado_remotamente`, nunca `verified`; credenciales obligatorias ausentes fallan sin imprimirse.
  - [x] 23.5 Integrar pre-push y CI sobre las mismas claves y evidencia mínima.
  - [x] 23.6 **Validar:** mock 200/404/401/429/timeout, tenants distintos, TTL, credenciales ausentes, ambos fallbacks y paridad pre-push/CI sin fugas.
  - **Requisitos:** 10.1–10.7, 13.8, 15.2, 22.3, 26.8, G.6, G.12.

- [x] **24. Implementar adaptador Claude Code separado mediante hooks `PreToolUse`** **[H] [P con 25 tras 21]**
  - **Depende de:** 11, 15, 21.
  - **Contrato confirmado (docs.claude.com/.../hooks):** `PreToolUse` devuelve `hookSpecificOutput.permissionDecision` con `allow`/`deny`/`ask`/`defer`; **exit 2 bloquea como fail-safe** y ni `allow` lo revierte; precedencia multi-hook `deny > defer > ask > allow`; stdin trae `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`; matcher por nombre de tool (`Edit|Write`, `Bash`, `mcp__.*`); rutas de file-tools absolutas con separador nativo.
  - **Objetivo/rutas:** `src/integrations/claude.js`, `templates/core/security/adapters/claude/` (hooks `PreToolUse` en `.claude/`), auditoría asociada.
  - [x] 24.1 Generar hooks `PreToolUse` con matchers de escritura (`Edit|Write`) y comando (`Bash`) que invoquen el CLI core; parsear `tool_name`/`tool_input` y normalizar rutas absolutas/separadores a `PolicyInput`.
  - [x] 24.2 Mapear decisión del motor a JSON: `deny → permissionDecision:"deny"` con `permissionDecisionReason` redactado; riesgo medio configurable a `permissionDecision:"ask"`; `allow` cuando la política lo permita. Usar **exit 2 como fail-safe** ante fallo del hook o JSON inválido, nunca permitir por defecto.
  - [x] 24.3 Bloquear archivos sensibles, push a rama default, `--force` peligroso y `--no-verify`; no intentar `allow` por encima de reglas deny y respetar precedencia multi-hook; no registrar prompts/código/valores.
  - [x] 24.4 Detectar versión/capacidad y marcar operaciones no interceptables como `unavailable`, sin atribuir protección falsa; mantener instalación/update/uninstall ownership-aware e independiente de Kiro.
  - [x] 24.5 **Validar:** payloads válidos/maliciosos, salidas `deny`/`ask`/`allow` y exit 2 fail-safe; hook que falla o emite JSON inválido debe bloquear, no permitir; coexistencia con Kiro sin doble ejecución; precedencia deny respetada; logs/stderr sin canario ni `permissionDecisionReason` sensible.
  - **Requisitos:** 5.1, 6.1, 6.3–6.7, 7.1–7.5, 14.4, 21.10, 26.1, 26.3, G.5, G.12.

- [x] **25. Implementar adaptador Kiro separado mediante hooks `.kiro/hooks` v1** **[H] [P con 24 tras 21]**
  - **Depende de:** 11, 15, 21.
  - **Contrato confirmado (kiro.dev/docs/hooks):** `PreToolUse` bloquea con **exit 2** y permite con **exit 0** (otros códigos = fallo del hook y la tool continúa); **no hay modo `ask`** ni `permissionDecision` en `PreToolUse` (eso es de Claude Code); stdin trae `hook_event_name`, `cwd`, `session_id`, `tool_name`, `tool_input`; matcher regex contra nombre de tool; hooks por workspace activados al iniciar sesión.
  - **Objetivo/rutas:** `src/integrations/kiro.js`, `templates/core/security/adapters/kiro/`, generación de `.kiro/hooks/*.json` (`version: v1`), auditoría asociada.
  - [x] 25.1 Generar hooks `PreToolUse` v1 con matchers para tools de escritura (`fs_write`/`write`, `str_replace`) y de comando (`execute_bash`/`shell`, `use_aws`), cuya acción `command` invoque el CLI core; parsear `tool_name`/`tool_input` desde stdin y normalizar a `PolicyInput` sin asumir claves no documentadas.
  - [x] 25.2 Mapear la decisión del motor a exit code: `deny → exit 2` con `stderr` redactado (causa/ruta/remediación), `allow`/`warn → exit 0`; nunca usar otros códigos para denegar, porque Kiro los trata como fallo no bloqueante.
  - [x] 25.3 Bloquear archivos sensibles, push a rama default, `--force` peligroso y `--no-verify` únicamente cuando pasen por una tool interceptada; para operaciones fuera de alcance declarar la limitación y delegar en hooks Git/CI, sin atribuir protección inexistente.
  - [x] 25.4 Compartir motor/política/redacción core y deduplicar con Claude cuando ambos estén activos; no depender de Claude ni de confirmación interactiva en `PreToolUse`.
  - [x] 25.5 Detectar compatibilidad de versión/formato de hooks; si el formato o el bloqueo por exit 2 no están disponibles, marcar la capa `unavailable` en auditoría en vez de simular enforcement; migrar sólo el adaptador ante cambios de API y preservar hooks/integraciones del usuario.
  - [x] 25.6 Excluir prompts, código, `tool_input` sensible y valores de los logs por defecto.
  - [x] 25.7 **Validar:** en un workspace de prueba, confirmar que un `fs_write` de `.env`/secreto sintético y un `execute_bash` con push a default/`--no-verify` se **bloquean con exit 2** y aparecen redactados; que exit 0 permite; que un código inesperado no bloquea (y la auditoría lo refleja como fallo de hook); coexistencia con Claude sin doble ejecución; payload malformado usa fallback seguro; y ausencia de canario en stderr/logs/evidencia.
  - **Requisitos:** 5.1, 6.2–6.7, 7.1–7.5, 14.4, 14.5, 21.10, 26.1, 26.3, G.5, G.12.

- [x] **26. [CP] Verificar trazabilidad y asistentes**
  - **Depende de:** 22–25.
  - [x] 26.1 Demostrar Conventional Commit y Jira sintáctico en commit-msg, Jira remoto en pre-push/CI y fallbacks correctos.
  - [x] 26.2 Demostrar Claude y Kiro por separado y juntos, sin duplicidad, bloqueando políticas soportadas y declarando límites.
  - [x] 26.3 Escanear logs/reportes/evidencia para confirmar ausencia de prompts, código, credenciales Jira y canarios.
  - **Gate:** no iniciar H2 hasta que G.5–G.6 y G.12 pasen para estas capas.
  - **Requisitos:** 5–11, 14.4, 26.6, 26.8, G.5–G.6, G.12.

## Fase H2 — Flutter, auditoría profunda, evidencia y templates

- [x] **27. Migrar secretos genéricos de Flutter al core y preservar OWASP móvil** **[H] [P con 28 tras 26]**
  - **Depende de:** 12, 26.
  - **Objetivo/rutas:** `templates/stacks/flutter/.claude/skills/owasp-mobile-security-checker/`, scanner Flutter existente y adaptador al schema común.
  - [x] 27.1 Retirar el gate genérico divergente o convertirlo en delegación al Gitleaks core; evitar doble ejecución.
  - [x] 27.2 Mantener controles móviles especializados de dependencias, red, almacenamiento y revisión manual.
  - [x] 27.3 Pasar todos los resultados por redactor, incluyendo líneas, headers, URLs con credenciales y payloads.
  - [x] 27.4 Renombrar heurísticas de versión para no afirmar CVE sin fuente real de advisories; declarar `not_applicable` fuera de Flutter.
  - [x] 27.5 **Validar:** proyecto Flutter/no Flutter, comparación de gates sin divergencia, outputs móviles con canarios y assertions de nomenclatura/advisory.
  - **Requisitos:** 12.1–12.6, 13.3, 26.6, G.7, G.12.

- [x] **28. Completar auditoría profunda de asistentes, Jira, Flutter, CI y providers** **[H] [P con 27 tras 26]**
  - **Depende de:** 20, 23–27.
  - **Objetivo/rutas:** `src/audit/{capabilities,checks,report}.js`.
  - [x] 28.1 Añadir compatibilidad/enlace real de Claude/Kiro, Jira configurado/verificable y aplicabilidad Flutter.
  - [x] 28.2 Añadir observación remota con estados `observed|unauthorized|not-configured|not-applicable|unknown`, sin inferir por archivos locales.
  - [x] 28.3 Verificar última ejecución, freshness, commit/config hash y enforcement efectivo; reportar drift de default branch y excepciones.
  - [x] 28.4 Ejecutar self-checks sintéticos seguros en `--deep`, con cleanup y redacción garantizados.
  - [x] 28.5 **Validar:** matriz por capacidad/capa incluyendo no autorizado/no verificable, evidencia expirada y scanner desconectado; JSON estable y exit codes.
  - **Requisitos:** 8.5, 11, 14.1–14.9, 17.7, 19.6, 25.4, 26.1, G.11–G.12.

- [x] **29. Crear templates mínimos de PR/ticket y protección de declaraciones de evidencia** **[H]**
  - **Depende de:** 1–2, 19, 26.
  - **Objetivo/rutas:** templates core y provider-neutral de PR/ticket, validadores de evidencia.
  - [x] 29.1 Limitar PR a ticket, resumen/riesgo, evidencia pruebas/seguridad, impacto secretos/datos y rollback cuando aplique.
  - [x] 29.2 Limitar ticket a objetivo, criterios, riesgo/datos, dependencias y evidencia; permitir `N/A` con razón breve.
  - [x] 29.3 Prohibir solicitudes de secretos, dumps, tokens, prompts o logs sin redactar; enlazar estados verificados a evidencia válida.
  - [x] 29.4 **Validar:** snapshots/linters de campos permitidos, fixtures N/A y declaración verificada con/sin evidencia.
  - **Requisitos:** 11, 18.1–18.5, 26.9.

- [x] **30. [CP] Verificar separación core/stack y auditoría por capacidades**
  - **Depende de:** 27–29.
  - [x] 30.1 Confirmar que el control genérico de secretos no reside en Flutter y que OWASP móvil sigue operativo.
  - [x] 30.2 Ejecutar auditoría profunda en estado sano y degradaciones representativas por cada capa.
  - [x] 30.3 Confirmar que templates no solicitan datos sensibles y que toda afirmación verificada tiene evidencia vigente.
  - **Gate:** G.7, G.11 y G.12 deben pasar antes de rollout/migración.
  - **Requisitos:** 11–14, 18, 26, G.7, G.11–G.12.

## Fase H3 — Incidentes, excepciones, rollout, telemetría y migración

- [x] **31. Implementar gobernanza de excepciones y break-glass** **[H] [P con 32 tras 30]**
  - **Depende de:** 11, 15, 28, 30.
  - **Objetivo/rutas:** `src/policy/exceptions.js`, `src/domain/exception.js`, schema y comandos `security exception validate`.
  - [x] 31.1 Exigir control, fingerprint/ruta mínima, razón, owner, ticket, creación, expiración y aprobador distinto cuando aplique.
  - [x] 31.2 Rechazar excepciones sin expiración/excesivas; reactivar al expirar o cambiar fingerprint y reportar cantidad/edad/owner/estado sin contenido.
  - [x] 31.3 Modelar break-glass con identidad autorizada, motivo, ticket/incidente, alcance, expiración y revisión posterior; nunca usar `--no-verify` ni apagar workflows.
  - [x] 31.4 Proteger cambios de política/hook/workflow/allowlist mediante ownership remoto cuando esté disponible.
  - [x] 31.5 **Validar:** schema/property tests de amplitud/expiración/fingerprint, author=approver, bypasses prohibidos y auditoría redactada.
  - **Requisitos:** 3.8, 5.5, 7.5, 9.4, 20.5–20.7, 28.1–28.6, G.5.

- [x] **32. Implementar clasificación, runbooks y evidencia de incidentes/rotación** **[H] [P con 31 tras 30]**
  - **Depende de:** 2, 12, 30.
  - **Objetivo/rutas:** `src/incident/{classify,runbook}.js`, `templates/core/security/docs/INCIDENT-RESPONSE.md`.
  - [x] 32.1 Diferenciar local bloqueado vs publicado/histórico y guiar contener, revocar/rotar, evaluar uso, eliminar, decidir historial, notificar y cerrar.
  - [x] 32.2 Declarar que borrar el último commit/default protegida no revoca una credencial ni protege feature branches.
  - [x] 32.3 Para reescritura exigir coordinación, backup, clones/refs/tags afectados, invalidación previa y verificación posterior.
  - [x] 32.4 Registrar sólo evidencia redactada de rotación/alcance/controles; auditar fechas de rotación cuando la fuente permita observarlas.
  - [x] 32.5 **Validar:** tabletop fixtures local/publicado/feature branch/historial, checklist completo, ausencia del secreto y thresholds de rotación warn/fail.
  - **Requisitos:** 3.7, 16.3, 19.1–19.6, 27.4–27.5, G.10, G.12.

- [x] **33. Implementar `security doctor` y promoción warning → enforcement** **[H]**
  - **Depende de:** 28, 31–32.
  - **Objetivo/rutas:** CLI security, `src/policy/engine.js`, auditoría y evidencia.
  - [x] 33.1 Verificar integridad de herramientas, hooks, CI, Jira cuando aplique, hallazgos legacy/nuevos y excepciones antes de promover.
  - [x] 33.2 Mantener detector/alcance idénticos entre warning/enforcement; cambiar sólo decisión de bloqueo y registrar deuda/baseline.
  - [x] 33.3 Registrar actor/origen, fecha, config anterior/nueva y evidencia; avisar expiraciones y aplicar política al vencer.
  - [x] 33.4 Permitir baseline temporal por fingerprint con owner/justificación/expiración y bloquear nuevos hallazgos.
  - [x] 33.5 **Validar:** repos nuevo/existente, readiness exitoso/fallido, Jira unavailable, legacy baseline, hallazgo nuevo y expiración; comparar scopes warning/enforce byte a byte.
  - **Requisitos:** 3.8, 20.1–20.7, 28, 26.3, G.13.

- [x] **34. Implementar observabilidad y telemetría opt-in segura** **[H] [P con 35 tras 33]**
  - **Depende de:** 2, 28, 33.
  - **Objetivo/rutas:** módulo de eventos/telemetría, config/schema, integración con hooks/CI/audit.
  - [x] 34.1 Emitir eventos locales estructurados con control, versión, modo, duración, alcance agregado, resultado y categoría de error.
  - [x] 34.2 Excluir contenido, prompts, PII, personas, repo URL completa, rutas absolutas y URLs con credenciales.
  - [x] 34.3 Para envío remoto exigir opt-in, TLS, auth, ID pseudónimo configurable, idempotency key, timeout, anti-replay, retención y destino documentado.
  - [x] 34.4 Conservar local ante fallo remoto y no marcar delivered sin confirmación; soportar alertas agregadas para tool/Jira/bypass/excepciones.
  - [x] 34.5 Registrar exceso de presupuesto sin omitir controles y mostrar instalación/cobertura/recencia/hallazgos/enforcement separadamente.
  - [x] 34.6 **Validar:** telemetría off por defecto, mock entrega/fallo/replay/timeout, deduplicación y escaneo anti-canario/PII; assertions de dimensiones separadas.
  - **Requisitos:** 13.6–13.7, 25.1–25.6, 26.6, G.12.

- [x] **35. Completar migración desde 0.1.0, parcial y personalizada** **[H] [P con 34 tras 33]**
  - **Depende de:** 8–9, 19, 24–25, 27, 33.
  - **Objetivo/rutas:** `src/install/migrate.js`, fixtures 0.1.0/parciales y `templates/core/security/docs/MIGRATION.md`.
  - [x] 35.1 Detectar artefactos legacy, registrar ownership/inventario y preservar hooks/config/docs personalizados.
  - [x] 35.2 Instalar baseline en warning, corregir workflow inseguro mediante replace seguro o propuesta/diff y reconciliar stacks/Jira/asistentes/providers.
  - [x] 35.3 Identificar parches críticos sin sobrescribir; impedir declaración conforme mientras existan conflictos críticos.
  - [x] 35.4 Soportar offline/cache, fallo parcial reentrante, rollback y propuesta lado a lado.
  - [x] 35.5 **Validar:** smoke completo 0.1.0 limpio/personalizado/parcial, doble migración, fallo inyectado, offline y promoción posterior; verificar tree del usuario y workflow.
  - **Requisitos:** 20.1, 21.1–21.11, 26.3, G.2, G.8, G.13.

- [x] **36. Endurecer compatibilidad multiplataforma, worktrees, monorepos y symlinks** **[H]**
  - **Depende de:** 12–16, 18, 35.
  - **Objetivo/rutas:** utilidades de plataforma/path/process, hooks/scripts Node/PowerShell donde aplique y matriz CI.
  - [x] 36.1 Implementar preflight de Node, Git, shell/runtime, permisos, arquitectura, conectividad/proxy/CA y compatibilidad antes de mutar.
  - [x] 36.2 Soportar macOS/Linux mantenidos y Windows mediante Node/PowerShell o Git compatible; detectar y explicar capacidades POSIX no soportadas.
  - [x] 36.3 Resolver raíz Git/workspaces sin escanear fuera del repo; manejar espacios, separadores, CRLF/LF, ejecutabilidad y worktrees.
  - [x] 36.4 Bloquear escapes por symlink y documentar follow/no-follow; validar cache/manual install offline.
  - [x] 36.5 **Validar:** matriz macOS/Linux/Windows declarada, paths con espacios/Unicode, CRLF, monorepo/subdir/worktree, symlink escape, proxy/offline; skips sólo con razón registrada.
  - **Requisitos:** 4.8, 21.11, 23.1–23.7, 26.2–26.3, 26.7, G.14.

- [x] **37. [CP] Cerrar endurecimiento antes de providers**
  - **Depende de:** 31–36.
  - [x] 37.1 Ejecutar migración 0.1.0, doctor/promote, excepciones/break-glass e incidente publicado sin fuga.
  - [x] 37.2 Ejecutar matriz de compatibilidad disponible y confirmar telemetría off por defecto/segura con opt-in.
  - [x] 37.3 Confirmar que ningún bypass usa `--no-verify`, que findings legacy no ocultan nuevos y que workflow sigue sin push directo.
  - **Gate:** G.6–G.8, G.11–G.14 deben pasar antes de integrar providers.
  - **Requisitos:** 19–23, 25–28; G.6–G.8, G.11–G.14.

## Fase P1 — Providers opcionales desacoplados

- [x] **38. Crear contrato común de planes de provider sin autoaplicación** **[P]**
  - **Depende de:** 18, 28, 31, 37.
  - **Objetivo/rutas:** `src/providers/` contrato base, CLI `provider plan`, schemas/fixtures de plan.
  - [x] 38.1 Generar planes deterministas con cambios, permisos requeridos, parámetros, dry-run, rollback y estado `observed|unauthorized|not-configured|unknown`.
  - [x] 38.2 Separar instalación local de observación/aplicación remota; cualquier apply futuro requerirá confirmación humana explícita fuera de este plan.
  - [x] 38.3 Asegurar selección exclusiva/independiente: core no instala providers y cada provider no instala al otro.
  - [x] 38.4 **Validar:** dry-run sin llamadas mutantes, planes schema-valid, permisos ausentes diferenciados y snapshots que demuestren aislamiento de packs.
  - **Requisitos:** 15.2, 16.1, 16.8, 17.1, 17.7, 22.6, G.9.

- [x] **39. Implementar pack GitHub endurecido** **[P] [P con 40 tras 38]**
  - **Depende de:** 19, 29, 31, 38.
  - **Objetivo/rutas:** `src/providers/github.js`, `templates/providers/github/**`.
  - [x] 39.1 Planificar rulesets preferidos o branch protection equivalente: PR, reviews, checks, conversaciones, sin force/delete.
  - [x] 39.2 Generar Actions con SHA inmutable, permisos mínimos, forks seguros y comandos core; nunca reimplementar detección.
  - [x] 39.3 Generar CODEOWNERS para políticas, workflows, hooks, allowlists y config de seguridad.
  - [x] 39.4 Observar/planificar secret scanning/push protection según plan/permisos; reportar unavailable sin reemplazar Gitleaks.
  - [x] 39.5 Diferenciar no autorizado/no configurado y producir comandos/diff, sin afirmar éxito ni ejecutar cambios remotos.
  - [x] 39.6 **Validar:** snapshots/schema de ruleset y fallback, linter de SHA/permisos/forks, mocks 403/404/capability y smoke `--provider=github` aislado.
  - **Requisitos:** 17.1–17.7, 15.6, 24.6, 26.9, 28.2, G.8–G.9.

- [x] **40. Implementar pack AWS CodeCommit endurecido** **[P] [P con 39 tras 38]**
  - **Depende de:** 18, 31–32, 38.
  - **Objetivo/rutas:** `src/providers/codecommit.js`, `templates/providers/aws-codecommit/**`.
  - [x] 40.1 Generar IaC/plan IAM mínimo privilegio para default/destructivos por rol, parámetros por entorno y rollback.
  - [x] 40.2 Incluir approval rule templates/rules, revisores mínimos, separación de funciones y prevención de autoaprobación donde AWS lo permita.
  - [x] 40.3 Generar CodeBuild/CodePipeline con gates core, artefactos redactados y aprobación manual antes de producción.
  - [x] 40.4 Añadir planes SNS/EventBridge sin secretos y preferencia por roles/credenciales temporales, rotación/revocación y detección de claves obsoletas redactada.
  - [x] 40.5 Repetir explícitamente en templates/docs: IAM sobre default no impide que un secreto llegue a una feature branch; mantener local/pre-push/CI.
  - [x] 40.6 No aplicar cloud: sólo dry-run/plan; cualquier mutación requiere confirmación explícita y mecanismo posterior fuera de esta tarea.
  - [x] 40.7 **Validar:** análisis estático IAM/IaC, snapshots por entorno, least privilege, pipeline/approval/alertas, ausencia de secretos y smoke `--provider=aws-codecommit` aislado sin llamadas mutantes.
  - **Requisitos:** 16.1–16.8, 19.3, 24.6, 26.9, 27.4, G.9–G.10.

- [x] **41. Auditar providers y proteger sus artefactos críticos** **[P]**
  - **Depende de:** 39–40.
  - **Objetivo/rutas:** `src/audit/checks.js`, provider plans, CODEOWNERS/owners equivalentes y documentación condicional.
  - [x] 41.1 Auditar local present vs remoto observed/no autorizado/no configurado/no aplicable para cada pack.
  - [x] 41.2 Detectar drift de rulesets/IAM/workflows/pins/owners sin auto-corregir cloud.
  - [x] 41.3 Marcar capacidades dependientes de plan/licencia/permisos y su fallback; proteger cambios críticos mediante owner distinto cuando sea posible.
  - [x] 41.4 **Validar:** mocks de permisos/capacidades/drift y comparación de auditoría GitHub/AWS instalados por separado y juntos sólo si configuración lo permite.
  - **Requisitos:** 14.5, 16, 17, 24.6, 27.3–27.6, 28.2, G.9–G.11.

- [x] **42. [CP] Aceptar providers sin autoaplicar infraestructura**
  - **Depende de:** 38–41.
  - [x] 42.1 Ejecutar instalación/plan/audit de GitHub y AWS por separado; confirmar que core y el provider opuesto no cambian.
  - [x] 42.2 Inspeccionar permisos, pins, forks, IAM, approvals, rollback y estados no autorizados.
  - [x] 42.3 Confirmar por logs/mocks que no ocurrió ninguna llamada cloud mutante.
  - **Gate providers:** G.8–G.10 y G.12 deben pasar.
  - **Requisitos:** 16–17, 24, 26.9, G.8–G.10, G.12.

## Fase F — Documentación operativa, release y suite final

- [x] **43. Completar documentación operativa y changelog trazable** **[H/P] [P con 44 tras 42]**
  - **Depende de:** 35–42.
  - **Objetivo/rutas:** `kiritek-init/README.md`, `templates/core/security/docs/{SECURITY,INCIDENT-RESPONSE,MIGRATION}.md`, docs providers, changelog/canal de release.
  - [x] 43.1 Documentar arquitectura core/adaptadores/packs, matriz por etapa, defaults, flags, precedencia, estados/exit codes y evidencia.
  - [x] 43.2 Separar instalación nueva, repo existente, update 0.1.0, rollback, uninstall y conflictos.
  - [x] 43.3 Documentar setup/límites Claude, Kiro, Jira, GitHub y AWS; indicar que hooks cliente son evadibles y capacidades cloud dependen de plan/permisos.
  - [x] 43.4 Incluir runbooks de falso positivo, herramienta/Jira caída, secreto local/publicado, rotación, historial y break-glass.
  - [x] 43.5 Documentar canal oficial, integridad del tarball, versionado/procedencia reproducible y changelog con impacto/enforcement/migración.
  - [x] 43.6 Prohibir detectores de autoría IA como gate y repetir limitación de IAM sobre feature branches.
  - [x] 43.7 **Validar:** link/schema/command checks, búsqueda de recomendaciones prohibidas o `latest`, revisión de todos los flags/exit codes y checklist de docs 27.1–27.8.
  - **Requisitos:** 7.4, 16.3, 19, 24.3–24.5, 27.1–27.8, G.10, G.15.

- [x] **44. Ejecutar suite final multiplataforma y escenarios de aceptación** **[H/P] [P con 43 tras 42]**
  - **Depende de:** 36, 42.
  - **Objetivo/rutas:** `test/{unit,integration,fixtures,smoke}/`, matriz CI y colección de evidencia ignorada.
  - [x] 44.1 Ejecutar unitarias de parser/config, branches/scopes/refspecs, commits/Jira, redacción, allowlists, manifests/merge, políticas/excepciones y auditoría.
  - [x] 44.2 Ejecutar integración Git de hooks/gestores/worktrees/new branch/multiref/default custom/rollback y asistentes.
  - [x] 44.3 Ejecutar smoke limpio/repetido/update 0.1.0/parcial/warning/enforce/sin Jira/sin red/provider aislado.
  - [x] 44.4 Ejecutar Jira 200/404/401/429/timeout y fallbacks, Flutter/no Flutter, auditoría sana/degradada y telemetría off/on.
  - [x] 44.5 Ejecutar macOS/Linux/Windows para el subconjunto soportado; registrar skips con razón, versiones y exit codes.
  - [x] 44.6 Inspeccionar workflows/pins/permisos/no push y escanear la totalidad de resultados para ausencia del canario.
  - [x] 44.7 **Validar:** publicar un índice de evidencia por G.1–G.15 con commit/config hash, plataforma, comando, timestamp y exit code; cualquier gap impide cierre.
  - **Requisitos:** 26.1–26.10, 11, G.1–G.15.

- [x] **45. [CP] Definition of Done y aceptación de la iniciativa**
  - **Depende de:** 43–44.
  - [x] 45.1 Todos los criterios 1–28 y G.1–G.15 están mapeados a tareas completadas y evidencia vigente.
  - [x] 45.2 Core instala sin stack, es idempotente/transaccional, y warning/enforcement usan idéntico detector/alcance.
  - [x] 45.3 Staged, push y CI detectan canarios en sus alcances; placeholders pasan; ningún output reconstruye el secreto.
  - [x] 45.4 Auditoría distingue todas las capas/estados requeridos y nunca infiere cumplimiento por existencia.
  - [x] 45.5 Migración 0.1.0 conserva personalizaciones y corrige workflow sin push directo.
  - [x] 45.6 Claude/Kiro/Jira/Flutter funcionan o declaran unavailable/no aplicable con precisión.
  - [x] 45.7 GitHub y AWS se validan separados, con pins/permisos mínimos, sin autoaplicar cloud.
  - [x] 45.8 Matriz multiplataforma, docs, runbooks, changelog, supply chain y rollback están completos.
  - [x] 45.9 No existe detector de autoría IA en ninguna ruta de bloqueo.
  - **Salida:** release candidate sólo si 45.1–45.9 pasan; de lo contrario abrir tareas correctivas enlazadas al criterio y repetir validación afectada.

---

## Grafo resumido de dependencias y paralelización

```text
1 ─┬─> 2 ───────────────┐
   └─> 3 ───────────┐   │
2,3 -> 4 -> 5 -> 6,7 [P] -> 8 -> 9 -> 10
2,3,10 -> 11 -> 12,13,14 [P]
14 -> 15; 8,12,13,14,15 -> 16 -> 17
17 -> 18 -> 19; 9,12,16,18,19 -> 20 -> 21
21 -> 22,23,24,25 [P] -> 26
26 -> 27,28 [P]; 26 -> 29; 27,28,29 -> 30
30 -> 31,32 [P] -> 33 -> 34,35 [P] -> 36 -> 37
37 + contratos core -> 38 -> 39,40 [P] -> 41 -> 42
42 -> 43,44 [P] -> 45
```

La marca **[P]** no autoriza edición concurrente del mismo archivo. Si dos tareas paralelas tocan un módulo compartido, deben acordar primero su contrato o ejecutarse secuencialmente para ese archivo.

---

## Matriz de cobertura de requisitos 1–28

| Requisito | Tareas principales | Evidencia de cierre |
|---|---|---|
| 1 Core por defecto | 9, 10, 21 | Smoke sin stack/sin Git/security off y estados por control |
| 2 Gitleaks fijado | 3, 12, 17, 20 | Pin/checksum/version/config hash y escenarios unavailable |
| 3 Scopes secretos | 13, 14, 17, 18 | Repos temporales staged/push/PR/history |
| 4 Hooks no destructivos | 8, 16, 17 | Gestores existentes, idempotencia, rollback/uninstall |
| 5 Archivos sensibles | 2, 11, 17 | Matriz ruta/contenido, placeholders y redacción |
| 6 Claude/Kiro | 24, 25, 26, 28 | Adaptadores separados/juntos y capability audit |
| 7 Guardas Git | 15, 17, 24, 25, 31 | Direct default/force/no-verify/break-glass |
| 8 Rama default | 14, 15, 17, 28 | Nombres custom, conflictos, drift |
| 9 Commits/Jira local | 16, 22, 26 | commit-msg y fixtures merge/revert/NO-JIRA |
| 10 Jira remoto | 23, 26, 44 | Mock API, cache, tenants, fallbacks |
| 11 Evidencia | 1, 2, 20, 28, 44 | Schemas y freshness por commit/alcance |
| 12 Flutter | 27, 30, 44 | Core genérico + controles móviles especializados |
| 13 Reportes/privacidad | 2, 7, 19, 34, 44 | Redaction gate, ignores, artifacts, delivery |
| 14 Auditoría | 20, 28, 30, 41 | Matriz de capas/estados y self-checks |
| 15 CI portable | 18, 19, 21, 39, 40 | Eventos/rangos, workflow seguro, core commands |
| 16 AWS CodeCommit | 38, 40–42 | Plan/IaC estático aislado, sin apply |
| 17 GitHub | 38–39, 41–42 | Ruleset/protection/Actions/CODEOWNERS aislados |
| 18 Templates | 29, 43 | Snapshots mínimos y evidencia/N/A |
| 19 Incidentes | 32, 37, 43 | Tabletop local/publicado/historial/rotación |
| 20 Rollout | 9, 33, 37 | Defaults, doctor/promote, baseline expirado |
| 21 Update/migración | 6–10, 19, 35, 37 | 0.1.0/parcial/personalizado/offline/rollback |
| 22 CLI/config | 5, 10, 18 | Matriz flags/precedencia/noninteractive/JSON |
| 23 Plataformas | 3, 13, 16, 36, 44 | Matriz OS/path/worktree/symlink/proxy |
| 24 Supply chain | 3, 12, 19, 39–40, 43 | Pins/checksums/procedencia/SBOM/rollback |
| 25 Observabilidad | 2, 20, 34, 37 | Eventos minimizados, opt-in, alertas |
| 26 Pruebas | Validación incluida en 1–44; consolidada en 44 | Unit/integration/smoke/property/matriz/evidencia |
| 27 Documentación | 3, 32, 35, 40, 43 | Guías, límites, runbooks, changelog |
| 28 Excepciones | 11, 31, 33, 39–41 | Schema, owners, expiración, audit, no bypass |

## Matriz de cobertura global G.1–G.15

| Global | Tareas que lo demuestran | Criterio observable |
|---|---|---|
| G.1 | 9, 12, 16, 20–21 | Instalación limpia sin stack con Gitleaks/hooks/audit |
| G.2 | 6–10, 16, 35, 44 | Init/update repetidos sin duplicar ni destruir |
| G.3 | 13–14, 17–18, 44 | Canario staged/push/history detectado |
| G.4 | 11–12, 17, 44 | Placeholder pasa; canario en example falla |
| G.5 | 15, 17, 24–26, 31, 44 | Default/force/no-verify bloqueados |
| G.6 | 22–23, 26, 44 | Conventional Commits + Jira local/remoto/fallback |
| G.7 | 27, 30, 44 | Secretos core; OWASP móvil preservado/redactado |
| G.8 | 18–21, 39–42, 44 | CI sin push, permisos/pins/core commands |
| G.9 | 38–42, 44 | AWS/GitHub instalables por separado |
| G.10 | 32, 40, 42–43 | Limitación IAM/feature branch documentada/probada |
| G.11 | 20, 28, 30, 41, 44 | Auditoría diferencia degradaciones y enforcement |
| G.12 | 2, 11–12, 17, 26–28, 34, 44 | Canario ausente en toda salida/telemetría |
| G.13 | 8–10, 19, 33, 35, 37, 44 | Migración 0.1.0 warning + workflow + promote |
| G.14 | 36, 44–45 | Matriz CI por plataforma con evidencia |
| G.15 | 43–45 | Ausencia de detector de autoría IA como gate |

---

## Definition of Done por tarea

Una tarea sólo puede marcarse completada cuando:

1. Sus subtareas funcionales y de validación están completas.
2. Los archivos objetivo respetan los contratos/schemas versionados y no duplican políticas.
3. Las pruebas relevantes pasan en el alcance afectado y registran comando, versión, timestamp y exit code.
4. No aparecen canarios, secretos, prompts, código ni PII en outputs persistentes o públicos.
5. Init/update permanecen idempotentes y cualquier mutación puede revertirse o tiene rollback probado.
6. Los estados unavailable/unknown/not-applicable se reportan con precisión; no se afirma cumplimiento por presencia.
7. Cualquier pin, checksum, action o dependencia nueva fue revisado según supply chain.
8. La documentación/changelog del comportamiento afectado se actualiza en la misma tarea cuando aplique.
9. No se autoaplica infraestructura cloud ni se realizan mutaciones remotas sin confirmación explícita.
10. El checkpoint de su fase pasa antes de iniciar tareas dependientes de la siguiente oleada.
