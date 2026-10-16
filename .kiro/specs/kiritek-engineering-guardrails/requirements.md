# Requirements — Kiritek Engineering Guardrails

## 1. Propósito

Esta spec define un pack Kiritek de buenas prácticas preventivas de ingeniería y producto. Su objetivo es detectar temprano omisiones funcionales verificables, ofrecer feedback accionable y, sólo cuando exista evidencia determinista suficiente, impedir que cambios incompletos avancen a una etapa donde su corrección sea más costosa.

El pack es deliberadamente independiente del baseline de seguridad. Reutiliza los contratos transversales maduros de `kiritek-init` —resultados estructurados, configuración validada, adaptadores, evidencia, excepciones y auditoría por capacidades— sin convertir preferencias de producto, heurísticas o ausencia de contexto en bloqueos arbitrarios.

Los guardrails iniciales cubren:

- comportamiento responsable de inputs de búsqueda;
- políticas de versión mínima soportada para aplicaciones móviles;
- anuncios explícitos y accesibles de módulos web nuevos.

El catálogo 2.0.0 amplía la cobertura con veintiún guardrails (requisitos 28–48), de interfaz y de backend:

- estados de carga, vacío y error en pantallas que cargan datos;
- formularios con validación y errores accesibles;
- llamadas de red con timeout, reintentos seguros e idempotencia;
- feature flags con dueño, vencimiento y valor por defecto seguro;
- sesión expirada sin bucles ni pérdida de trabajo;
- subida de archivos con límites, progreso, cancelación y reintento;
- listas largas paginadas sin duplicados ni saltos;
- eventos de analytics con esquema y sin datos personales;
- acciones destructivas con confirmación o deshacer;
- formato de fechas, números y montos por idioma;
- modo sin conexión con cola y sincronización;
- permisos del dispositivo pedidos en contexto y tolerantes al rechazo;
- rutas inexistentes, URLs mal formadas y enlaces que sobreviven al login;
- diálogos accesibles con teclado y lector de pantalla;
- APIs idempotentes, con errores consistentes, límites de uso y paginación acotada;
- servicios que toleran dependencias caídas y se apagan sin cortar requests;
- logs estructurados, correlacionados y sin datos personales ni secretos.

La definición integral de seguridad sigue siendo la autoridad para sus propios controles en `.kiro/specs/kiritek-init-integral-security/requirements.md` y `.kiro/specs/kiritek-init-integral-security/design.md`. Esta spec no la reemplaza ni modifica.

## 2. Principios normativos

1. **Separación de dominios:** ingeniería/producto y seguridad tienen configuración, niveles, catálogos, resultados agregados y promoción independientes.
2. **Aplicabilidad honesta:** un control sólo evalúa unidades para las que existe evidencia de perfil y contexto aplicable; `not_applicable`, `unknown` y `unavailable` no equivalen a cumplimiento.
3. **Precisión antes que severidad:** las heurísticas sólo producen `warn`; `deny` requiere evidencia determinista, vigente y atribuible al cambio evaluado.
4. **Collectors no deciden:** la recolección observa hechos; los evaluators aplican reglas versionadas sobre observaciones normalizadas.
5. **Un contrato, varias superficies:** agente, Git y CI consumen la misma evaluación; los adaptadores no reimplementan controles.
6. **Feedback temprano, gate tardío:** la latencia y el costo permitido aumentan desde agente y pre-commit hasta PR y release.
7. **No prescribir una implementación única:** los controles verifican resultados y contratos de comportamiento, no nombres de frameworks, librerías o patrones internos salvo cuando formen parte de un contrato esencial.
8. **No afirmar lo no demostrado:** presencia de archivos, nombres o dependencias no prueba comportamiento en ejecución.
9. **Privacidad por defecto:** no se persiste código, prompts, consultas, PII, payloads ni datos de usuarios como evidencia.
10. **Adopción reversible:** instalación, rollout, actualización, rollback y desinstalación preservan personalizaciones y permiten volver a un estado conocido.

## 3. Alcance

### 3.1 Incluido

- Pack `engineering/guardrails` separado de `core/security`.
- Perfiles funcionales explícitos por workspace: `web`, `mobile-app`, `search`, `module-launch` y perfiles extensibles.
- Catálogo de controles versionado, resoluble y auditable.
- Nivel independiente `off | warn | enforce` por control, con defaults por perfil y overrides acotados.
- Detección de aplicabilidad, confianza, evidencia y limitaciones.
- Collectors y evaluators separados mediante contratos estables.
- Ejecución en momentos `agent`, `pre-commit`, `PR` y `release`.
- Monorepos, workspaces anidados y cambios multiunidad.
- Excepciones y waivers gobernados.
- CI provider-neutral, reportes, auditoría, observabilidad y métricas minimizadas.
- Rollout, actualización, migración, compatibilidad, extensibilidad, documentación y pruebas.

### 3.2 Fuera de alcance

- Sustituir discovery, research, UX review, QA exploratorio, revisión de arquitectura o aprobación de producto.
- Inferir intención de negocio exclusivamente desde código, nombres de ramas, tickets o prompts.
- Bloquear por estilo, preferencia de framework, patrón arquitectónico subjetivo o ausencia de una tecnología concreta.
- Probar rendimiento real de producción mediante análisis estático aislado.
- Recopilar consultas reales, identificadores de dispositivo, contenido de usuario o telemetría de producto sin el sistema de consentimiento correspondiente.
- Gestionar publicación, aprobación o configuración remota de App Store, Google Play, feature flags, analytics o canales de mensajería.
- Definir políticas de seguridad, secretos, IAM, protección de ramas o respuesta a incidentes, cubiertas por la spec integral de seguridad.
- Aplicar cambios destructivos o desplegar infraestructura automáticamente.
- Garantizar que hooks locales no puedan evadirse; PR y release son las superficies de enforcement compartido.

## 4. Referencias y contratos existentes

Se reutilizarán, sin duplicar su lógica, los contratos relevantes de:

- `.kiro/specs/kiritek-init-integral-security/requirements.md`
- `.kiro/specs/kiritek-init-integral-security/design.md`
- `kiritek-init/src/domain/result.js`
- `kiritek-init/src/domain/evidence.js`
- `kiritek-init/src/domain/exception.js`
- `kiritek-init/src/config/load.js`
- `kiritek-init/src/config/validate.js`
- `kiritek-init/src/policy/engine.js`
- `kiritek-init/src/integrations/kiro.js`
- `kiritek-init/src/integrations/claude.js`
- `kiritek-init/src/integrations/ci.js`
- `kiritek-init/src/audit/capabilities.js`

## 5. Glosario

- **Guardrail:** control preventivo que observa evidencia y produce una decisión antes o durante una etapa del ciclo de entrega.
- **Perfil funcional:** declaración explícita de capacidades del workspace o unidad, por ejemplo `search`; no es una inferencia de stack.
- **Unidad:** ámbito mínimo evaluable dentro de un repositorio, como aplicación, paquete, módulo o servicio.
- **Catálogo:** conjunto versionado de controles, contratos, perfiles compatibles, parámetros y reglas de compatibilidad.
- **Collector:** componente sin autoridad de decisión que obtiene observaciones normalizadas desde código, configuración, tests, artefactos o proveedores inyectados.
- **Evaluator:** componente determinista que transforma observaciones, configuración y contexto en `PolicyResult`.
- **Evidencia determinista:** observación reproducible que prueba de forma inequívoca una condición definida para el alcance, revisión y versión de control evaluados.
- **Heurística:** señal probabilística o aproximada que puede orientar revisión, pero no demostrar incumplimiento.
- **Confianza:** nivel declarado de soporte de una conclusión: `deterministic`, `high`, `medium`, `low` o `unknown`.
- **Aplicabilidad:** estado `applicable`, `not_applicable`, `unknown` o `unavailable`, acompañado de razón y fuente.
- **Nivel:** `off`, `warn` o `enforce` configurado por control de ingeniería/producto.
- **Momento:** superficie `agent`, `pre-commit`, `pr` o `release` donde se ejecuta un control.
- **N/A gobernado:** declaración explícita y trazable de no aplicabilidad, con alcance, razón, owner y revisión cuando corresponda.
- **Waiver:** aceptación temporal y acotada de un incumplimiento conocido; no es desactivación global.
- **Show-once:** política que evita repetir un anuncio a la misma audiencia según una clave y periodo definidos, sin exigir una tecnología de persistencia concreta.

## 6. Requisitos y criterios de aceptación

### Requisito 1 — Pack independiente y contrato de resultados

**Historia de usuario:** Como responsable de plataforma, quiero un pack de guardrails separado de seguridad para gobernar prácticas de ingeniería/producto sin alterar la postura de seguridad.

#### Criterios de aceptación

1.1. **CUANDO** se instale o habilite el pack, **EL SISTEMA DEBERÁ** identificarlo como `engineering/guardrails` o un identificador equivalente distinto de `core/security`.

1.2. **MIENTRAS** un control de seguridad esté en cualquier modo, **LOS NIVELES DE ENGINEERING GUARDRAILS DEBERÁN** resolverse sin heredar, elevar ni reducir ese modo.

1.3. **CUANDO** un evaluator termine, **EL SISTEMA DEBERÁ** emitir el contrato común `PolicyResult` con `decision: allow | warn | deny | error`, `controlId`, severidad, estado de herramienta, findings redactados, razón y referencia de evidencia cuando exista.

1.4. **CUANDO** se agreguen resultados de seguridad y engineering, **EL SISTEMA DEBERÁ** conservar dominio, identidad, decisión y remediación de cada control sin convertir un `allow` de un dominio en prueba sobre el otro.

1.5. **SI** el pack de guardrails está ausente o deshabilitado, **LA AUDITORÍA DE SEGURIDAD NO DEBERÁ** marcarse fallida por esa causa, ni viceversa.

1.6. **CUANDO** una superficie traduzca un resultado, **EL ADAPTADOR DEBERÁ** respetar el protocolo real de Git, Kiro, Claude o CI y no alterar la decisión central salvo el mapeo documentado de capacidades.

### Requisito 2 — Perfiles funcionales explícitos y extensibles

**Historia de usuario:** Como owner de un workspace, quiero declarar sus capacidades funcionales para ejecutar sólo controles pertinentes.

#### Criterios de aceptación

2.1. **CUANDO** se configure una unidad, **EL SISTEMA DEBERÁ** aceptar cero o más perfiles explícitos, incluyendo como mínimo `web`, `mobile-app`, `search` y `module-launch`.

2.2. **CUANDO** se detecten frameworks, dependencias, rutas o nombres relacionados, **EL SISTEMA PODRÁ** sugerir perfiles con confianza y razones, pero **NO DEBERÁ** activarlos ni aplicar enforcement sin aceptación o configuración explícita.

2.3. **SI** una unidad no declara perfiles, **EL SISTEMA DEBERÁ** reportar los controles dependientes de perfil como `not_applicable` o `unknown` según la evidencia, no como aprobados o incumplidos.

2.4. **CUANDO** un workspace declare un perfil personalizado, **EL VALIDADOR DEBERÁ** comprobar identificador namespaceado, versión, catálogo de origen, esquema de parámetros y perfiles base compatibles.

2.5. **SI** un perfil combina capacidades, **LA RESOLUCIÓN DEBERÁ** producir una lista determinista de controles sin duplicados y explicar su procedencia.

2.6. **CUANDO** un repositorio contenga varias unidades, **LOS PERFILES DEBERÁN** poder declararse por unidad y no propagarse globalmente salvo herencia explícita.

2.7. **SI** una unidad hereda y sobrescribe perfiles, **EL SISTEMA DEBERÁ** mostrar configuración efectiva y origen de cada valor.

### Requisito 3 — Configuración validada y niveles por control

**Historia de usuario:** Como equipo, quiero graduar cada control de forma independiente para adoptar guardrails sin bloqueos inesperados.

#### Criterios de aceptación

3.1. **CUANDO** se cargue la configuración, **EL SISTEMA DEBERÁ** validarla contra un esquema versionado y rechazar propiedades, niveles, IDs o tipos desconocidos con ubicación y remediación.

3.2. **CUANDO** se configure un control, **EL SISTEMA DEBERÁ** aceptar exactamente `off`, `warn` o `enforce` como nivel efectivo.

3.3. **CUANDO** existan defaults de catálogo, configuración organizacional permitida, repositorio, unidad, entorno o flags, **EL SISTEMA DEBERÁ** aplicar una precedencia documentada y mostrar el origen del nivel efectivo.

3.4. **SI** un nivel se establece en `off`, **EL SISTEMA DEBERÁ** registrar que no fue evaluado y no presentar el control como conforme.

3.5. **SI** un nivel se establece en `warn`, **EL SISTEMA DEBERÁ** ejecutar y reportar el control sin bloquear la operación por findings de ese control.

3.6. **SI** un nivel se establece en `enforce`, **EL SISTEMA SÓLO DEBERÁ** producir `deny` cuando se cumplan los requisitos de evidencia determinista del Requisito 8.

3.7. **CUANDO** un control no soporte enforcement seguro, **EL CATÁLOGO Y EL VALIDADOR DEBERÁN** impedir configurarlo en `enforce` o degradarlo explícitamente a `warn` con diagnóstico; nunca silenciosamente.

3.8. **SI** la configuración efectiva es inválida o ambigua, **EL SISTEMA DEBERÁ** producir `error` y no sustituirla por defaults ocultos.

### Requisito 4 — Catálogo versionado y resolución reproducible

**Historia de usuario:** Como mantenedor, quiero un catálogo versionado para que una misma revisión produzca controles reproducibles.

#### Criterios de aceptación

4.1. **CUANDO** se distribuya un catálogo, **EL SISTEMA DEBERÁ** asignarle versión inmutable y declarar controles, versiones de contrato, perfiles, momentos, parámetros, niveles soportados y compatibilidad.

4.2. **CUANDO** se ejecute una evaluación, **LA EVIDENCIA DEBERÁ** identificar versión efectiva del catálogo y versión de cada control.

4.3. **SI** se solicita una versión no instalada o incompatible, **EL SISTEMA DEBERÁ** producir un error accionable sin resolver automáticamente a `latest`.

4.4. **CUANDO** un catálogo cambie defaults, aplicabilidad, severidad o semántica de enforcement, **EL CAMBIO DEBERÁ** declararse en notas de migración y respetar versionado semántico.

4.5. **CUANDO** se actualice el catálogo, **EL CLI DEBERÁ** ofrecer un plan/diff que muestre controles añadidos, retirados, renombrados, cambios de nivel efectivo y migraciones requeridas.

4.6. **MIENTRAS** una evaluación esté en curso, **EL SISTEMA DEBERÁ** usar una resolución fija del catálogo y no mezclar versiones descargadas o cacheadas durante la misma ejecución.

4.7. **SI** un control es retirado, **EL SISTEMA DEBERÁ** conservar trazabilidad histórica y ofrecer reemplazo o razón de deprecación.

### Requisito 5 — Aplicabilidad honesta

**Historia de usuario:** Como desarrollador, quiero saber por qué un control aplica para no recibir conclusiones falsas sobre código fuera de alcance.

#### Criterios de aceptación

5.1. **ANTES DE** evaluar una política funcional, **EL SISTEMA DEBERÁ** resolver aplicabilidad por control, unidad, perfil, momento y alcance del cambio.

5.2. **CUANDO** determine aplicabilidad, **EL SISTEMA DEBERÁ** devolver estado, razones, fuentes observadas y confianza sin usar mera presencia de un template como prueba funcional.

5.3. **SI** el perfil requerido no está declarado, **EL CONTROL DEBERÁ** ser `not_applicable` o `unknown` y no generar `deny`.

5.4. **SI** faltan datos necesarios por limitación de herramienta, permisos, checkout o plataforma, **EL CONTROL DEBERÁ** ser `unavailable` o `unknown`, distinguiendo la causa.

5.5. **CUANDO** una unidad no haya cambiado y el control sea estrictamente change-scoped, **EL SISTEMA DEBERÁ** omitirla con razón y conservar la posibilidad de evaluación completa en release.

5.6. **CUANDO** el usuario declare N/A para un control aplicable, **EL SISTEMA DEBERÁ** tratarlo mediante el flujo gobernado del Requisito 18 y no como una edición libre del resultado.

5.7. **SI** varias señales de aplicabilidad se contradicen, **EL SISTEMA DEBERÁ** reportar ambigüedad y abstenerse de enforcement.

### Requisito 6 — Separación entre collectors y evaluators

**Historia de usuario:** Como autor de controles, quiero separar observación y decisión para probar políticas sin depender de herramientas concretas.

#### Criterios de aceptación

6.1. **CUANDO** un collector observe el workspace, **DEBERÁ** producir datos normalizados y procedencia, sin emitir `allow`, `warn` o `deny`.

6.2. **CUANDO** un evaluator reciba observaciones, **DEBERÁ** producir una decisión sin leer archivos, invocar red, mutar configuración ni ejecutar herramientas por sí mismo.

6.3. **SI** un collector falla, devuelve datos parciales o excede timeout, **EL SISTEMA DEBERÁ** preservar ese estado como observación explícita y no fabricar valores ausentes.

6.4. **CUANDO** distintos collectors aporten la misma clase de evidencia, **EL SISTEMA DEBERÁ** conservar fuente, versión, timestamp y alcance de cada observación para resolver conflictos determinísticamente.

6.5. **CUANDO** un adaptador ejecute un control, **DEBERÁ** invocar collectors/evaluators compartidos y no contener reglas funcionales duplicadas.

6.6. **CUANDO** se pruebe un evaluator, **DEBERÁ** poder ejecutarse con observaciones fixture sin filesystem, red ni reloj no inyectado.

### Requisito 7 — Evidencia, confianza y vigencia

**Historia de usuario:** Como reviewer, quiero conocer la fuerza y procedencia de cada conclusión para decidir si puede bloquear.

#### Criterios de aceptación

7.1. **CUANDO** se produzca un finding, **EL SISTEMA DEBERÁ** asociar tipo de evidencia, fuente, revisión/commit, unidad, alcance, timestamp, versión de collector/evaluator y confianza.

7.2. **CUANDO** se asigne confianza, **EL SISTEMA DEBERÁ** usar `deterministic`, `high`, `medium`, `low` o `unknown` conforme a reglas versionadas del control.

7.3. **SI** la evidencia corresponde a otro commit, configuración, catálogo, unidad o alcance, **NO DEBERÁ** sustentar un estado verificado ni un bloqueo actual.

7.4. **SI** la evidencia expira según el control, **EL SISTEMA DEBERÁ** marcarla stale y requerir reevaluación para release o enforcement.

7.5. **CUANDO** dos fuentes deterministas se contradigan, **EL RESULTADO DEBERÁ** ser `error` o `warn` por conflicto y no `deny` hasta resolverlo.

7.6. **CUANDO** una revisión manual aporte evidencia, **EL SISTEMA DEBERÁ** registrar reviewer, alcance, checklist, fecha, expiración y referencia, sin describirla como automatización.

7.7. **CUANDO** se persista evidencia, **DEBERÁ** excluir código, consultas, prompts, payloads, tokens, PII y rutas absolutas salvo una política explícita más restrictiva y consentida.

### Requisito 8 — Heurísticas sólo warning y bloqueo determinista

**Historia de usuario:** Como desarrollador, quiero que sólo incumplimientos demostrados bloqueen mi flujo para evitar falsos positivos costosos.

#### Criterios de aceptación

8.1. **CUANDO** una conclusión se base total o parcialmente en nombres, regex aproximadas, inferencia de AST incompleta, presencia/ausencia de dependencias o convenciones de framework, **EL RESULTADO MÁXIMO DEBERÁ** ser `warn`.

8.2. **CUANDO** un control configurado en `enforce` pretenda producir `deny`, **EL EVALUATOR DEBERÁ** demostrar una condición de fallo determinista documentada, aplicabilidad confirmada y evidencia vigente atribuible al alcance.

8.3. **SI** falta cualquiera de las condiciones de 8.2, **EL RESULTADO DEBERÁ** ser `warn`, `allow` o `error` según la causa, nunca `deny`.

8.4. **CUANDO** un control mezcle señales deterministas y heurísticas, **EL SISTEMA DEBERÁ** separar findings y permitir que sólo los deterministas participen en el bloqueo.

8.5. **CUANDO** cambie una regla de clasificación de heurística a determinista, **EL CATÁLOGO DEBERÁ** incluir contrato verificable, pruebas y nota de migración antes de habilitar enforcement.

8.6. **CUANDO** se muestre un warning heurístico, **EL MENSAJE DEBERÁ** declarar la incertidumbre, evidencia observada y pasos para confirmar o descartar.

### Requisito 9 — Control `search.input-rate`

**Historia de usuario:** Como owner de búsqueda, quiero prevenir solicitudes excesivas y resultados obsoletos sin imponer una librería concreta.

#### Criterios de aceptación

9.1. **CUANDO** una unidad con perfil `search` declare un input interactivo que dispara búsquedas remotas o costosas, **EL CONTROL DEBERÁ** verificar que exista una política explícita de cadencia mediante debounce, throttle o mecanismo conductualmente equivalente.

9.2. **CUANDO** el usuario introduzca menos caracteres que el mínimo configurado, **EL COMPORTAMIENTO VERIFICADO DEBERÁ** evitar iniciar la búsqueda costosa, salvo una excepción funcional explícita y probada.

9.3. **CUANDO** una nueva consulta vuelva obsoleta una solicitud en curso, **EL COMPORTAMIENTO VERIFICADO DEBERÁ** cancelar la solicitud cuando la plataforma lo soporte o impedir que su respuesta obsoleta reemplace resultados más recientes.

9.4. **CUANDO** se emitan solicitudes lógicamente equivalentes dentro de la ventana configurada, **EL COMPORTAMIENTO VERIFICADO DEBERÁ** deduplicarlas o demostrar un mecanismo equivalente que evite trabajo redundante.

9.5. **CUANDO** se evalúe la cadencia, **EL CONTROL NO DEBERÁ** exigir simultáneamente debounce y throttle ni imponer valores universales; los parámetros deberán ser explícitos y apropiados al producto.

9.6. **CUANDO** se configure `search.input-rate` en `enforce`, **EL BLOQUEO SÓLO DEBERÁ** basarse en tests de comportamiento ejecutados con reloj y transporte controlables que demuestren el incumplimiento.

9.7. **SI** sólo se detecta un handler, una llamada de red o ausencia aparente de una librería, **EL CONTROL DEBERÁ** emitir como máximo `warn` y solicitar evidencia de comportamiento.

9.8. **CUANDO** los tests verifiquen el control, **DEBERÁN** cubrir como mínimo ráfaga de input, mínimo de caracteres, nueva consulta durante una anterior, respuesta fuera de orden, consultas equivalentes y propagación de error/cancelación.

9.9. **SI** la búsqueda es exclusivamente local y su costo medido queda bajo el umbral declarado, **EL EQUIPO PODRÁ** declarar no aplicable la cadencia remota, conservando evidencia y owner.

9.10. **CUANDO** se reporte un finding, **EL SISTEMA DEBERÁ** evitar persistir los textos de consulta usados por usuarios reales; las pruebas deberán usar datos sintéticos.

### Requisito 10 — Control `app.minimum-supported-version`

**Historia de usuario:** Como owner de una app, quiero una política fiable de versión mínima para retirar versiones incompatibles sin bloquear usuarios por errores de configuración o conectividad.

#### Criterios de aceptación

10.1. **CUANDO** una unidad `mobile-app` habilite el control, **DEBERÁ** declarar una fuente confiable y autenticable para la versión mínima, su entorno, estrategia de cache y comportamiento ante indisponibilidad.

10.2. **CUANDO** se compare la versión instalada con la mínima, **EL COMPORTAMIENTO DEBERÁ** usar semántica de versión declarada y validada, incluyendo prereleases y build metadata cuando apliquen, sin comparación lexicográfica ambigua.

10.3. **CUANDO** la versión esté por debajo del mínimo, **LA POLÍTICA DEBERÁ** distinguir actualización `hard` de `soft` y definir acciones observables para cada una.

10.4. **CUANDO** exista un periodo de gracia, **LA POLÍTICA DEBERÁ** declarar inicio, duración, fuente temporal confiable, audiencia y transición al estado posterior, evitando depender únicamente de un reloj local manipulable cuando ello cambie un hard update.

10.5. **CUANDO** el dispositivo esté offline, **EL COMPORTAMIENTO DEBERÁ** usar una política explícita para cache válida, primera ejecución sin cache y cache expirada, sin transformar indisponibilidad de red en bloqueo indefinido no documentado.

10.6. **CUANDO** se active un hard update, **EL FLUJO DEBERÁ** conservar acceso a la acción de actualización, explicar el motivo de forma accesible y evitar loops sin salida cuando el store o enlace no esté disponible.

10.7. **CUANDO** se active un soft update, **EL FLUJO DEBERÁ** permitir continuar o posponer conforme a frecuencia y audiencia configuradas.

10.8. **CUANDO** se resuelva el destino de actualización, **LA POLÍTICA DEBERÁ** contemplar stores/plataformas soportadas, distribución empresarial cuando aplique y fallback seguro para stores no disponibles.

10.9. **CUANDO** una versión mínima publicada resulte defectuosa, **EL SISTEMA OPERATIVO DEL PRODUCTO DEBERÁ** admitir rollback o corrección de política sin requerir publicar primero una nueva versión de la app.

10.10. **CUANDO** exista una emergencia, **EL PRODUCTO DEBERÁ** admitir override gobernado, autenticado, acotado por entorno/audiencia, expirable, auditable y reversible.

10.11. **CUANDO** se cambie la política de versión, **DEBERÁ** existir observabilidad minimizada de fetch, parseo, cache, decisión, store y override, con alertas sobre tasas anómalas sin identificadores innecesarios.

10.12. **CUANDO** `app.minimum-supported-version` esté en `enforce`, **EL GATE DE RELEASE SÓLO DEBERÁ** bloquear por contrato/configuración determinista inválida o por tests de comportamiento fallidos; no bloqueará porque una fuente remota esté temporalmente inaccesible durante análisis local.

10.13. **CUANDO** se pruebe el control, **LOS TESTS DEBERÁN** cubrir versiones menor/igual/mayor, prerelease, payload inválido, firma/autenticidad inválida, timeout, offline con/sin cache, gracia, hard/soft, store ausente, rollback y override expirado.

### Requisito 11 — Control `web.module-announcement`

**Historia de usuario:** Como owner de un módulo web, quiero anunciar funcionalidades nuevas a las audiencias correctas sin depender de inferencias frágiles ni perjudicar accesibilidad.

#### Criterios de aceptación

11.1. **CUANDO** una unidad `web` con perfil `module-launch` introduzca un módulo que requiera anuncio, **EL CAMBIO DEBERÁ** incluir una señal explícita versionada que vincule módulo, anuncio o declaración N/A gobernada.

11.2. **CUANDO** exista un anuncio, **SU METADATA DEBERÁ** incluir identificador estable, versión o ventana, owner, audiencia, canales, contenido/localización referenciable, política show-once y estado de rollout.

11.3. **CUANDO** se defina audiencia, **LA CONFIGURACIÓN DEBERÁ** expresar criterios permitidos y fallback, evitando incluir PII o segmentos sensibles sin gobernanza externa apropiada.

11.4. **CUANDO** se declaren canales, **EL SISTEMA DEBERÁ** validar que pertenecen al conjunto soportado por el workspace y que al menos uno es alcanzable para cada audiencia objetivo o existe fallback explícito.

11.5. **CUANDO** un anuncio use show-once, **EL COMPORTAMIENTO DEBERÁ** definir clave de deduplicación, alcance de audiencia, periodo y tratamiento de almacenamiento ausente, borrado o no disponible.

11.6. **CUANDO** se renderice un anuncio, **LOS TESTS DE COMPORTAMIENTO DEBERÁN** demostrar navegación por teclado, foco predecible, nombre/rol/estado accesibles, cierre no atrapante, contraste conforme al estándar adoptado y compatibilidad con reduced motion cuando haya animación.

11.7. **CUANDO** contenido o localización falten, **EL COMPORTAMIENTO DEBERÁ** aplicar un fallback explícito y no mostrar claves internas, contenido vacío ni markup roto.

11.8. **CUANDO** el módulo no deba anunciarse, **EL OWNER DEBERÁ** registrar N/A gobernado con razón, alcance, fecha/revisión y evidencia de aprobación según criticidad.

11.9. **CUANDO** `web.module-announcement` esté en `enforce`, **EL GATE SÓLO DEBERÁ** bloquear por ausencia determinista de señal requerida, metadata schema-invalid, N/A inválido o tests contractuales fallidos.

11.10. **SI** la existencia de un módulo nuevo se infiere sólo por rutas, componentes, nombres o diff, **EL RESULTADO MÁXIMO DEBERÁ** ser `warn` solicitando confirmación de lanzamiento.

11.11. **CUANDO** se retire o pause un anuncio, **LA CONFIGURACIÓN DEBERÁ** permitir rollback sin retirar el módulo y conservar trazabilidad del cambio.

### Requisito 12 — Momentos de ejecución y presupuesto de feedback

**Historia de usuario:** Como desarrollador, quiero feedback proporcional al momento para corregir temprano sin degradar mi flujo.

#### Criterios de aceptación

12.1. **CUANDO** opere un agente compatible, **EL ADAPTADOR AGENT DEBERÁ** evaluar cambios protegibles antes de escribir o ejecutar cuando la herramienta lo permita, priorizando collectors rápidos y findings accionables.

12.2. **CUANDO** se ejecute `pre-commit`, **EL SISTEMA DEBERÁ** limitarse al contenido staged y a controles locales deterministas o rápidos, sin requerir red por defecto.

12.3. **CUANDO** se ejecute un PR, **EL SISTEMA DEBERÁ** evaluar el rango completo, ejecutar tests de comportamiento seleccionados y producir anotaciones/reportes provider-neutral.

12.4. **CUANDO** se ejecute un release, **EL SISTEMA DEBERÁ** evaluar el artefacto y configuración candidata, evidencia vigente y controles release-only antes de declarar readiness.

12.5. **CUANDO** un control declare momentos soportados, **EL CATÁLOGO DEBERÁ** identificar cobertura, costo esperado, timeout y evidencia mínima por momento.

12.6. **SI** una superficie no puede ejecutar un control, **DEBERÁ** reportarlo como cobertura pendiente y no simular el resultado de otra superficie.

12.7. **CUANDO** la misma revisión se evalúe en varias superficies, **EL SISTEMA PODRÁ** reutilizar evidencia sólo si coinciden commit, configuración, catálogo, plataforma relevante y alcance.

12.8. **CUANDO** se exceda el presupuesto de tiempo, **EL RESULTADO DEBERÁ** distinguir timeout de incumplimiento y seguir el fallback declarado por control.

### Requisito 13 — Adaptadores de agente, Git y CI

**Historia de usuario:** Como equipo que usa distintas herramientas, quiero política consistente adaptada a capacidades reales.

#### Criterios de aceptación

13.1. **CUANDO** se habiliten Kiro o Claude, **EL INSTALADOR DEBERÁ** integrar adaptadores separados que consuman el motor compartido y respeten sus protocolos nativos.

13.2. **CUANDO** Kiro reciba `warn`, **EL ADAPTADOR DEBERÁ** permitir con feedback; **CUANDO** reciba un `deny` determinista en enforcement, **DEBERÁ** usar el mecanismo de bloqueo soportado, sin inventar modo interactivo inexistente.

13.3. **CUANDO** Claude soporte confirmación intermedia, **EL ADAPTADOR PODRÁ** traducir warnings según configuración, pero no elevar una heurística a denegación central.

13.4. **SI** una operación no es interceptable por el agente, **LA AUDITORÍA DEBERÁ** declararlo y señalar Git/CI como cobertura posterior.

13.5. **CUANDO** los hooks Git se instalen junto a hooks existentes, **EL INSTALADOR DEBERÁ** componerlos de forma idempotente y no destructiva o generar integración manual verificable.

13.6. **CUANDO** CI ejecute guardrails, **EL ADAPTADOR DEBERÁ** delegar en comandos core no interactivos y no duplicar evaluators en YAML del proveedor.

13.7. **CUANDO** se registren eventos de agente, **EL ADAPTADOR DEBERÁ** excluir prompts, código y tool input no minimizado.

### Requisito 14 — Monorepos y alcance multiunidad

**Historia de usuario:** Como owner de un monorepo, quiero aplicar perfiles y controles por unidad sin perder dependencias cruzadas.

#### Criterios de aceptación

14.1. **CUANDO** el repositorio declare workspaces, **EL SISTEMA DEBERÁ** resolver unidades mediante configuración explícita y permitir detección asistida no autoritativa.

14.2. **CUANDO** un archivo cambie, **EL SISTEMA DEBERÁ** mapearlo a cero, una o varias unidades con razón; un archivo compartido podrá afectar múltiples unidades.

14.3. **CUANDO** cambie configuración raíz, catálogo, tooling compartido o contratos transitivos, **EL SISTEMA DEBERÁ** ampliar el alcance a las unidades dependientes según un grafo declarado o verificable.

14.4. **SI** no puede resolverse el impacto de un cambio compartido, **EL SISTEMA DEBERÁ** advertir y ampliar la evaluación o requerir alcance explícito; no deberá omitir unidades silenciosamente.

14.5. **CUANDO** se agreguen resultados, **EL REPORTE DEBERÁ** preservar unidad, perfil, control, configuración efectiva y decisión individual antes del resumen del repositorio.

14.6. **CUANDO** unidades distintas usen versiones compatibles diferentes de un perfil/control, **EL SISTEMA DEBERÁ** resolverlas aisladamente y evitar contaminación de cache.

14.7. **CUANDO** una unidad se renombre o mueva, **LA MIGRACIÓN DEBERÁ** conservar o invalidar explícitamente evidencia, waivers y show-once metadata según identidad estable.

### Requisito 15 — Privacidad y manejo de datos

**Historia de usuario:** Como responsable de privacidad, quiero guardrails útiles sin convertir análisis y reportes en una nueva fuente de datos sensibles.

#### Criterios de aceptación

15.1. **CUANDO** collectors analicen código o tests, **EL SISTEMA DEBERÁ** procesar localmente por defecto y persistir sólo metadatos mínimos redactados.

15.2. **CUANDO** se reporte `search.input-rate`, **NO DEBERÁ** incluir consultas reales, historiales de usuario ni payloads de respuesta.

15.3. **CUANDO** se reporte versión mínima, **NO DEBERÁ** incluir identificadores de dispositivo, cuenta, advertising ID ni tokens de store.

15.4. **CUANDO** se reporte module announcement, **NO DEBERÁ** incluir listas de usuarios, atributos sensibles ni contenido privado no necesario para remediación.

15.5. **SI** se habilita telemetría remota, **EL SISTEMA DEBERÁ** requerir opt-in, destino documentado, minimización, autenticación, cifrado en tránsito, retención, borrado e idempotencia.

15.6. **CUANDO** se publiquen artefactos CI, **EL SISTEMA DEBERÁ** ejecutar validación de redacción, aplicar acceso/retención mínimos y fallar la publicación si la redacción no puede verificarse.

15.7. **CUANDO** un plugin externo solicite datos adicionales, **EL VALIDADOR DEBERÁ** exigir declaración de categorías, finalidad y política de persistencia antes de habilitarlo.

### Requisito 16 — Performance, timeouts y recursos

**Historia de usuario:** Como desarrollador, quiero guardrails rápidos y previsibles para que la prevención no degrade la productividad ni CI.

#### Criterios de aceptación

16.1. **CUANDO** un control se registre, **EL CATÁLOGO DEBERÁ** declarar clase de costo, momentos permitidos, timeout y estrategia de cache.

16.2. **MIENTRAS** se ejecute en agent o pre-commit, **EL SISTEMA DEBERÁ** evitar scans completos si un alcance incremental verificable es suficiente.

16.3. **CUANDO** se reutilice cache, **EL SISTEMA DEBERÁ** vincularla a versiones, configuración, unidad, plataforma relevante y hash de entradas para evitar resultados stale.

16.4. **CUANDO** se ejecuten collectors independientes, **EL SISTEMA PODRÁ** paralelizarlos dentro de límites configurables de CPU, memoria y procesos.

16.5. **SI** un collector excede timeout o recursos, **EL SISTEMA DEBERÁ** terminarlo, limpiar temporales y producir `unavailable/error` o warning según el contrato, no un falso `allow`.

16.6. **CUANDO** termine una ejecución, **LA EVIDENCIA DEBERÁ** incluir duración y cache hit/miss sin exponer inputs.

16.7. **CUANDO** una actualización degrade presupuestos establecidos, **LAS PRUEBAS DE PERFORMANCE DEBERÁN** detectarlo antes de promover el catálogo.

### Requisito 17 — CI provider-neutral y release gate

**Historia de usuario:** Como equipo multiplataforma, quiero los mismos guardrails en cualquier CI y un gate de release reproducible.

#### Criterios de aceptación

17.1. **CUANDO** se invoque CI, **EL CLI DEBERÁ** aceptar de forma no interactiva evento, revisión/rango, unidad, momento, nivel y directorio de resultados mediante interfaces documentadas.

17.2. **CUANDO** un proveedor adapte resultados, **DEBERÁ** conservar JSON, exit code y evidencia portables como mínimo común.

17.3. **SI** el checkout o artefacto no cubre el alcance requerido, **EL JOB DEBERÁ** obtenerlo o fallar accionablemente; no reducirá alcance silenciosamente.

17.4. **CUANDO** se evalúe código no confiable de forks, **EL JOB DEBERÁ** evitar credenciales privilegiadas y collectors remotos no seguros.

17.5. **CUANDO** un release gate bloquee, **DEBERÁ** listar únicamente findings deterministas no exceptuados, controles afectados, evidencia y remediación.

17.6. **SI** existen sólo warnings heurísticos, **EL RELEASE GATE NO DEBERÁ** bloquear, aunque podrá requerir acknowledgement fuera del motor si la organización lo define.

17.7. **CUANDO** CI reintente, **EL SISTEMA DEBERÁ** producir resultados idempotentes para la misma revisión y distinguir flakiness de corrección real.

### Requisito 18 — Excepciones, waivers y N/A gobernado

**Historia de usuario:** Como owner, quiero gestionar casos legítimos temporalmente sin desactivar controles para todo el repositorio.

#### Criterios de aceptación

18.1. **CUANDO** se cree un waiver, **EL SISTEMA DEBERÁ** exigir control, unidad/alcance mínimo, finding o condición, razón, owner, aprobador según política, ticket, creación y expiración.

18.2. **CUANDO** se declare N/A gobernado, **EL SISTEMA DEBERÁ** exigir control, unidad, razón funcional, owner, evidencia y fecha de revisión; no necesitará fingir un finding.

18.3. **SI** un waiver o N/A es global, indefinido, sin owner o sin alcance verificable, **EL VALIDADOR DEBERÁ** rechazarlo.

18.4. **CUANDO** expire, cambie el fingerprint/alcance o deje de coincidir la unidad, **EL SISTEMA DEBERÁ** reactivar la evaluación automáticamente.

18.5. **CUANDO** una excepción aplique, **EL REPORTE DEBERÁ** mostrar estado `suppressed`, identidad redactada, expiración y deuda restante; no deberá convertirlo en `allow` limpio.

18.6. **CUANDO** se modifiquen excepciones, **EL SISTEMA DEBERÁ** permitir controles de ownership/review externos y conservar historial auditable.

18.7. **CUANDO** exista una emergencia de producto, **EL OVERRIDE OPERATIVO NO DEBERÁ** reutilizar `--no-verify`; seguirá un flujo separado, expirable y revisable.

### Requisito 19 — Auditoría por capacidades reales

**Historia de usuario:** Como responsable de ingeniería, quiero saber qué guardrails funcionan realmente y dónde existen brechas.

#### Criterios de aceptación

19.1. **CUANDO** se ejecute auditoría, **EL SISTEMA DEBERÁ** evaluar por control: aplicabilidad, catálogo/versión, instalación, integridad, configuración, activación, ejecutabilidad, momentos cubiertos, nivel, última ejecución, frescura, resultado, drift y evidencia.

19.2. **CUANDO** audite perfiles, **DEBERÁ** distinguir declaración explícita de sugerencia inferida y mostrar configuración efectiva por unidad.

19.3. **CUANDO** audite collectors/evaluators, **DEBERÁ** verificar linkage real, compatibilidad y versión, no sólo existencia de archivos.

19.4. **CUANDO** audite agent, Git, PR o release, **DEBERÁ** informar cada superficie por separado y declarar operaciones no interceptables.

19.5. **SI** una capacidad remota no se observa con permisos suficientes, **EL ESTADO DEBERÁ** ser `unknown`, `unauthorized`, `not-configured` o `not-applicable`, nunca `verified` por configuración local.

19.6. **CUANDO** se use auditoría profunda, **EL SISTEMA DEBERÁ** ejecutar canarios sintéticos seguros para demostrar findings, decisiones y redacción sin afectar producto o datos reales.

19.7. **CUANDO** finalice, **LA AUDITORÍA DEBERÁ** producir salida humana y schema-versioned JSON con resumen por unidad, perfil, control, momento y nivel.

### Requisito 20 — Observabilidad y calidad del rollout

**Historia de usuario:** Como owner del programa, quiero medir utilidad y falsos positivos para promover enforcement con evidencia.

#### Criterios de aceptación

20.1. **CUANDO** se mida adopción, **EL SISTEMA DEBERÁ** separar instalación, aplicabilidad, ejecuciones, warnings, denies, errors, waivers y remediaciones.

20.2. **CUANDO** se mida calidad, **EL SISTEMA DEBERÁ** permitir registrar confirmación, falso positivo, tiempo de remediación, flakiness y override sin recopilar código ni datos de usuario.

20.3. **CUANDO** un control tenga tasa de falsos positivos o error superior al umbral configurado, **EL SISTEMA DEBERÁ** impedir su promoción automática a `enforce`.

20.4. **CUANDO** haya regresión de latencia, disponibilidad o tasa de bloqueo, **LA OBSERVABILIDAD DEBERÁ** permitir identificar catálogo, control, versión, momento y plataforma.

20.5. **SI** falla el transporte remoto, **EL RESULTADO LOCAL DEBERÁ** conservarse y la entrega deberá marcarse no confirmada.

20.6. **CUANDO** se definan SLOs del pack, **DEBERÁN** cubrir latencia, disponibilidad del evaluator, determinismo, tasa de flake y redacción, sin confundirlos con KPIs del producto evaluado.

### Requisito 21 — Rollout gradual y promoción

**Historia de usuario:** Como organización, quiero adoptar controles gradualmente para corregir brechas antes de bloquear entregas.

#### Criterios de aceptación

21.1. **CUANDO** se habilite un control nuevo en un repositorio existente, **SU NIVEL INICIAL DEBERÁ** ser `warn` salvo decisión organizacional explícita respaldada por readiness.

21.2. **CUANDO** se promueva a `enforce`, **EL SISTEMA DEBERÁ** verificar aplicabilidad estable, collectors disponibles, evidencia determinista, tests verdes, presupuesto de performance, ownership, documentación y ausencia de waivers inválidos.

21.3. **CUANDO** se proponga promoción, **EL CLI DEBERÁ** ofrecer plan por unidad/control y no promover otros controles implícitamente.

21.4. **CUANDO** aumenten errores, flakes o falsos positivos tras promoción, **EL SISTEMA DEBERÁ** permitir rollback rápido a `warn` sin perder evidencia ni configuración previa.

21.5. **CUANDO** se habilite por cohortes, **LA CONFIGURACIÓN DEBERÁ** identificar alcance y duración sin usar atributos personales no gobernados.

21.6. **CUANDO** concluya un periodo de observación, **EL SISTEMA NO DEBERÁ** promover automáticamente sólo por tiempo transcurrido; requerirá criterios de readiness satisfechos.

### Requisito 22 — Instalación, actualización, migración y rollback

**Historia de usuario:** Como mantenedor, quiero actualizar el pack sin perder personalizaciones ni cambiar gates inesperadamente.

#### Criterios de aceptación

22.1. **CUANDO** se instale o actualice, **EL SISTEMA DEBERÁ** inventariar artefactos administrados, versiones, hashes, ownership y estrategia de reconciliación.

22.2. **CUANDO** se ejecute update, **EL SISTEMA DEBERÁ** producir dry-run con cambios de catálogo, schema, perfiles, controles, niveles efectivos, hooks y documentación.

22.3. **SI** una migración sobrescribiría contenido user-owned o configuración ambigua, **EL SISTEMA DEBERÁ** detenerse, conservar estado y ofrecer diff/resolución explícita.

22.4. **CUANDO** se apliquen cambios, **LA OPERACIÓN DEBERÁ** ser transaccional o producir rollback verificable de archivos, inventario y wiring.

22.5. **CUANDO** una versión cambie enforcement o aplicabilidad, **LA ACTUALIZACIÓN NO DEBERÁ** promover controles existentes silenciosamente.

22.6. **CUANDO** se desinstale, **EL SISTEMA DEBERÁ** retirar sólo artefactos y bloques Kiritek, restaurar composición registrada y conservar reportes según política explícita.

22.7. **CUANDO** se haga downgrade, **EL SISTEMA DEBERÁ** validar compatibilidad de schema/catálogo o impedirlo con instrucciones de recuperación.

### Requisito 23 — Extensibilidad y aislamiento de plugins

**Historia de usuario:** Como equipo de plataforma, quiero añadir perfiles y controles internos sin forking del motor.

#### Criterios de aceptación

23.1. **CUANDO** se registre una extensión, **DEBERÁ** declarar namespace, versión, contrato compatible, perfiles, collectors, evaluators, schemas, momentos, datos requeridos y niveles soportados.

23.2. **CUANDO** dos extensiones declaren el mismo ID o namespace incompatible, **EL SISTEMA DEBERÁ** rechazar la resolución de forma determinista.

23.3. **CUANDO** un plugin ejecute código, **EL SISTEMA DEBERÁ** aplicar timeout, límites, directorios temporales aislados y declaración de filesystem/red/entorno requeridos.

23.4. **SI** un plugin usa heurísticas, **EL MOTOR DEBERÁ** limitar sus resultados a `warn` independientemente del nivel solicitado.

23.5. **SI** un plugin declara enforcement, **DEBERÁ** aportar contrato determinista y suite de conformidad; de lo contrario el validador rechazará ese nivel.

23.6. **CUANDO** falle una extensión, **EL SISTEMA DEBERÁ** aislar el error, identificar el control afectado y evitar corromper resultados de otros controles.

23.7. **CUANDO** una extensión solicite telemetría o datos sensibles, **DEBERÁ** superar los requisitos de privacidad y consentimiento del pack antes de activarse.

### Requisito 24 — Compatibilidad y portabilidad

**Historia de usuario:** Como desarrollador multiplataforma, quiero resultados equivalentes donde la capacidad exista y degradación explícita donde no.

#### Criterios de aceptación

24.1. **CUANDO** se publique una versión, **EL PACK DEBERÁ** declarar matriz de Node, sistemas operativos, arquitecturas, Git, Kiro, Claude y entornos CI soportados.

24.2. **MIENTRAS** opere en macOS, Linux o Windows soportado, **EL SISTEMA DEBERÁ** manejar separadores nativos, rutas con espacios, Unicode, symlinks permitidos y worktrees sin construir shell inseguro.

24.3. **SI** una capacidad depende de plataforma, **EL CATÁLOGO DEBERÁ** declararla y la auditoría reportará `unavailable/not_applicable` en lugar de cumplimiento falso.

24.4. **CUANDO** se ejecute offline, **EL SISTEMA DEBERÁ** usar sólo catálogo, herramientas y evidencia verificadas disponibles localmente y declarar qué controles no pudieron completarse.

24.5. **CUANDO** existan proxy o CA corporativa, **LAS OPERACIONES DE RED OPCIONALES DEBERÁN** respetar configuración soportada sin desactivar validación de autenticidad silenciosamente.

24.6. **CUANDO** cambie un protocolo de agente o CI, **LA COMPATIBILIDAD DEBERÁ** resolverse en el adaptador afectado sin cambiar semántica de los evaluators.

### Requisito 25 — Documentación y experiencia de remediación

**Historia de usuario:** Como usuario del pack, quiero entender cada resultado y corregirlo sin conocer internals de Kiritek.

#### Criterios de aceptación

25.1. **CUANDO** se distribuya un control, **LA DOCUMENTACIÓN DEBERÁ** describir propósito, perfiles, aplicabilidad, momentos, parámetros, evidencia, confianza, condiciones de warn/deny, N/A, ejemplos y limitaciones.

25.2. **CUANDO** se emita un finding, **EL MENSAJE DEBERÁ** incluir control, unidad, condición observada, nivel, confianza, evidencia redactada, remediación y enlace/ruta documental estable.

25.3. **CUANDO** un resultado sea heurístico, **LA DOCUMENTACIÓN Y EL MENSAJE DEBERÁN** indicar que requiere confirmación y cómo aportar evidencia determinista.

25.4. **CUANDO** un resultado sea `error` o `unavailable`, **EL MENSAJE DEBERÁ** distinguir fallo de herramienta, configuración, compatibilidad, permisos, timeout y datos insuficientes.

25.5. **CUANDO** se documenten los controles iniciales, **DEBERÁN** incluir matrices de comportamiento y casos límite para búsqueda, versión mínima y anuncio de módulo.

25.6. **CUANDO** se publique una actualización, **LAS NOTAS DE RELEASE DEBERÁN** listar cambios de catálogo, compatibilidad, migración, defaults y semántica de enforcement.

### Requisito 26 — Estrategia integral de pruebas

**Historia de usuario:** Como mantenedor, quiero demostrar que los gates son correctos, deterministas y seguros antes de bloquear entregas.

#### Criterios de aceptación

26.1. **CUANDO** se implemente configuración o catálogo, **LAS PRUEBAS DEBERÁN** cubrir schemas, propiedades desconocidas, precedencia, herencia, overrides por unidad y migraciones.

26.2. **CUANDO** se implemente un evaluator, **LAS PRUEBAS UNITARIAS DEBERÁN** cubrir cada transición `allow/warn/deny/error`, aplicabilidad, confianza, evidencia stale/conflictiva y waivers.

26.3. **CUANDO** se implemente un collector, **LAS PRUEBAS DEBERÁN** cubrir datos completos/parciales, errores, timeout, plataformas, procedencia y ausencia de autoridad de decisión.

26.4. **CUANDO** se implemente un adaptador, **LAS PRUEBAS DE CONTRATO DEBERÁN** usar payloads válidos/inválidos y verificar traducción exacta sin filtrar inputs sensibles.

26.5. **CUANDO** se prueben hooks Git, **DEBERÁN** cubrir staged/unstaged, hooks existentes, managers, worktrees, rutas con espacios, rollback, idempotencia y bypass documentado.

26.6. **CUANDO** se pruebe CI/release, **DEBERÁN** cubrir checkout insuficiente, forks, retries, artifacts, monorepo, cambios compartidos y resultados reproducibles.

26.7. **CUANDO** se pruebe privacidad, **CANARIOS SINTÉTICOS DEBERÁN** demostrar que prompts, código, consultas, PII y payloads no aparecen en stdout, JSON, logs, cache ni artefactos.

26.8. **CUANDO** se pruebe determinismo, **LA MISMA ENTRADA NORMALIZADA DEBERÁ** producir el mismo resultado independientemente del adaptador, orden de collectors o reloj no relevante.

26.9. **CUANDO** se prueben parsers y mapeos de workspace, **LAS PRUEBAS DE PROPIEDAD/FUZZ DEBERÁN** cubrir rutas, Unicode, manifests, versiones semánticas y payloads malformados.

26.10. **ANTES DE** permitir enforcement para un control, **LA SUITE DE CONFORMIDAD DEBERÁ** probar que ninguna evidencia heurística, parcial, stale, conflictiva o no aplicable produce `deny`.

### Requisito 27 — Criterios globales de aceptación del pack

**Historia de usuario:** Como sponsor técnico, quiero criterios de salida globales para evitar publicar gates delicados incompletos.

#### Criterios de aceptación

27.1. **ANTES DE** declarar el pack listo, **EL SISTEMA DEBERÁ** demostrar separación efectiva respecto de security en configuración, niveles, promoción, auditoría y desinstalación.

27.2. **ANTES DE** declarar el pack listo, **DEBERÁN** existir perfiles explícitos `web`, `mobile-app`, `search`, `module-launch` y un mecanismo validado para extensiones namespaceadas.

27.3. **ANTES DE** declarar el pack listo, **LOS TRES CONTROLES INICIALES DEBERÁN** cumplir sus matrices de tests de comportamiento y contratos de evidencia.

27.4. **ANTES DE** habilitar cualquier `deny`, **DEBERÁ** demostrarse mediante suite de conformidad que el finding es determinista, aplicable, vigente, reproducible y atribuible al alcance.

27.5. **ANTES DE** publicar, **LA MATRIZ DE COMPATIBILIDAD Y LOS SMOKE TESTS DEBERÁN** pasar en todas las plataformas declaradas como soportadas.

27.6. **ANTES DE** publicar, **LAS PRUEBAS DE PRIVACIDAD, REDACCIÓN, ROLLBACK, MONOREPO, OFFLINE Y PERFORMANCE DEBERÁN** pasar sin excepciones abiertas críticas.

27.7. **CUANDO** alguna condición global no se cumpla, **EL PACK DEBERÁ** permanecer experimental o warning-only y documentar la brecha.

### Requisito 28 — Control `ui.data-states`

**Historia de usuario:** Como owner de una pantalla que carga datos, quiero que el usuario siempre vea en qué estado está la carga, sin pantallas en blanco ni esperas infinitas.

#### Criterios de aceptación

28.1. **CUANDO** una unidad con perfil `data-views` declare pantallas en su contrato de estados, **EL CONTROL DEBERÁ** verificar por comportamiento los estados de carga, contenido, vacío y error de cada pantalla declarada.

28.2. **MIENTRAS** los datos cargan, **EL COMPORTAMIENTO VERIFICADO DEBERÁ** mostrar un estado de carga anunciado a tecnologías de asistencia, nunca una pantalla en blanco.

28.3. **CUANDO** la carga falle o no responda dentro del `timeoutMs` declarado, **LA PANTALLA DEBERÁ** pasar a un estado de error y, si el contrato lo exige, ofrecer un reintento que vuelva a cargar.

28.4. **CUANDO** la respuesta no traiga datos y el contrato exija estado vacío, **LA PANTALLA DEBERÁ** mostrar un estado vacío explícito distinto del error.

28.5. **CUANDO** la pantalla se monte, **DEBERÁ** disparar una sola carga.

28.6. **SI** sólo se detectan llamadas de red o librerías de datos sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn` pidiendo el contrato.

28.7. **CUANDO** se reporte un finding, **EL SISTEMA NO DEBERÁ** persistir los datos cargados ni texto renderizado; el transporte del harness es sintético.

### Requisito 29 — Control `ui.form-validation`

**Historia de usuario:** Como owner de un formulario, quiero que valide lo que el usuario escribe, que los errores sean accesibles y que nunca se pierda lo escrito.

#### Criterios de aceptación

29.1. **CUANDO** una unidad con perfil `forms` declare formularios con sus campos y restricciones, **EL CONTROL DEBERÁ** verificar por comportamiento la validación, los mensajes de error y el envío.

29.2. **CUANDO** el usuario intente enviar con campos obligatorios vacíos o con formato/largo inválido, **EL FORMULARIO NO DEBERÁ** enviarse y **DEBERÁ** marcar cada campo inválido sin marcar campos válidos.

29.3. **CUANDO** un campo sea inválido, **SU MENSAJE DEBERÁ** estar asociado al campo para tecnologías de asistencia, ser texto legible (no vacío, sin claves internas ni markup) y el foco **DEBERÁ** ir al primer campo inválido.

29.4. **CUANDO** se envíe varias veces mientras un envío está en curso, **EL FORMULARIO DEBERÁ** enviar una sola vez.

29.5. **SI** el envío falla, **EL FORMULARIO DEBERÁ** conservar lo escrito, anunciar el error y permitir reenviar.

29.6. **CUANDO** el usuario corrija un campo, **SU ERROR DEBERÁ** desaparecer.

29.7. **CUANDO** se ejecuten los escenarios, **LOS VALORES DEBERÁN** ser sintéticos y **NO DEBERÁN** aparecer en trazas, reportes ni evidencia.

### Requisito 30 — Control `net.resilient-requests`

**Historia de usuario:** Como owner de un cliente de APIs, quiero que las llamadas no se cuelguen, reintenten sólo cuando es seguro y nunca dupliquen operaciones.

#### Criterios de aceptación

30.1. **CUANDO** una unidad con perfil `network-client` declare operaciones con timeout, política de reintento e idempotencia, **EL CONTROL DEBERÁ** verificarlas con reloj y transporte controlados.

30.2. **CUANDO** el servidor no responda, **LA LLAMADA DEBERÁ** terminar dentro de lo que permiten su timeout y su política de reintentos.

30.3. **CUANDO** ocurra una falla transitoria declarada como reintentable (5xx, red, timeout, 429), **EL CLIENTE DEBERÁ** reintentar sin superar `maxAttempts`, esperando según el backoff declarado y respetando `Retry-After`.

30.4. **CUANDO** la respuesta sea un error del cliente (4xx distinto de 429), **EL CLIENTE NO DEBERÁ** reintentar.

30.5. **SI** una operación no idempotente sufre un error ambiguo, **EL CLIENTE DEBERÁ** no reintentar o reintentar con la misma clave de idempotencia; un contrato que declare reintentos ambiguos sin clave **DEBERÁ** reportarse como inseguro.

30.6. **SI** sólo se detectan llamadas HTTP sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

30.7. **CUANDO** se reporte un finding, **EL SISTEMA NO DEBERÁ** persistir URLs, payloads, headers ni claves de idempotencia.

### Requisito 31 — Control `flags.lifecycle`

**Historia de usuario:** Como owner de un producto con feature flags, quiero que cada flag tenga dueño y fecha de retiro, que las vencidas se noten y que una falla del proveedor nunca abra funcionalidades por error.

#### Criterios de aceptación

31.1. **CUANDO** una unidad con perfil `feature-flags` declare su registro de flags, **CADA FLAG DEBERÁ** tener clave única, dueño, tipo, fecha de creación y valor por defecto.

31.2. **CUANDO** una flag sea temporal (`release` o `experiment`), **DEBERÁ** declarar fecha de retiro dentro de la vida máxima configurada; una flag temporal vencida **DEBERÁ** reportarse como finding determinista.

31.3. **CUANDO** una flag sea de permiso, **SU VALOR POR DEFECTO DEBERÁ** ser `false`; un kill switch **DEBERÁ** ser booleano.

31.4. **CUANDO** el registro declare un cliente propio, **EL CONTROL DEBERÁ** verificar que use el valor del proveedor, devuelva el default si el proveedor falla, no responde o entrega un tipo incorrecto, resuelva como apagada una flag no registrada y refleje los cambios dentro del intervalo de refresco.

31.5. **CUANDO** una flag temporal venza dentro del plazo de aviso configurado, **EL SISTEMA DEBERÁ** informarlo sin tratarlo como incumplimiento.

31.6. **SI** sólo se detecta el uso de un SDK de flags sin registro, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 32 — Control `auth.session-expiry`

**Historia de usuario:** Como owner de una app con sesiones, quiero que una sesión vencida se renueve sin molestar o lleve al login sin que el usuario pierda lo que estaba haciendo.

#### Criterios de aceptación

32.1. **CUANDO** una unidad con perfil `auth-session` declare su contrato de sesión, **EL CONTROL DEBERÁ** verificar con tokens y transporte sintéticos qué ocurre ante un 401.

32.2. **CUANDO** el contrato declare renovación de token y un pedido reciba 401, **EL CLIENTE DEBERÁ** renovar una vez y repetir el pedido con el token nuevo; si varios pedidos reciben 401 a la vez, **DEBERÁ** renovar una sola vez para todos.

32.3. **SI** la renovación falla o el token nuevo también es rechazado, **EL CLIENTE NO DEBERÁ** seguir reintentando y **DEBERÁ** llevar al usuario al login.

32.4. **CUANDO** el contrato exija conservar el trabajo, **LA APP DEBERÁ** conservar el trabajo en curso al llevar al login.

32.5. **SI** sólo se detecta manejo de tokens o de 401 sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

32.6. **LOS TOKENS Y EL TRABAJO DEL USUARIO NO DEBERÁN** aparecer en trazas, reportes ni evidencia.

### Requisito 33 — Control `ui.file-upload`

**Historia de usuario:** Como owner de una función de subida de archivos, quiero que se rechace lo inválido antes de subir y que el usuario vea, cancele y reintente sus subidas.

#### Criterios de aceptación

33.1. **CUANDO** una unidad con perfil `file-upload` declare sus puntos de subida con tamaño máximo y tipos aceptados, **EL CONTROL DEBERÁ** verificarlos con archivos y transporte sintéticos.

33.2. **CUANDO** un archivo supere el tamaño o no sea de un tipo aceptado, **LA APP DEBERÁ** rechazarlo antes de subir, con un mensaje legible.

33.3. **MIENTRAS** se sube un archivo válido, **LA APP DEBERÁ** mostrar el progreso y **DEBERÁ** subirlo una sola vez aunque se inicie dos veces.

33.4. **CUANDO** el contrato lo exija, **EL USUARIO DEBERÁ** poder cancelar una subida en curso (abortando la transferencia) y reintentar una subida fallida.

33.5. **SI** el contrato acepta cualquier tipo (`*/*`) sin permiso explícito o un tamaño por encima del límite configurado, **EL CONTROL DEBERÁ** reportarlo como finding determinista.

33.6. **NOMBRES Y CONTENIDO DE ARCHIVOS NO DEBERÁN** aparecer en trazas, reportes ni evidencia.

### Requisito 34 — Control `ui.pagination`

**Historia de usuario:** Como owner de una lista larga, quiero que cargue por páginas sin repetir, saltar ni desordenar ítems.

#### Criterios de aceptación

34.1. **CUANDO** una unidad con perfil `paginated-lists` declare sus listas con tamaño de página y modo, **EL CONTROL DEBERÁ** verificarlas con un dataset sintético.

34.2. **AL** montar, **LA LISTA DEBERÁ** pedir una sola página del tamaño declarado.

34.3. **CUANDO** se pagine hasta el final, **DEBERÁN** aparecer todos los ítems, sin duplicados, en el orden de la fuente y, si se exige, con indicación de fin; sin pedir más de una página extra ni volver a pedir después del fin.

34.4. **CUANDO** se pida cargar más mientras hay una página en vuelo, **LA LISTA DEBERÁ** ignorar el segundo pedido.

34.5. **SI** una página falla, **LA LISTA DEBERÁ** conservar lo ya cargado, mostrar el error y recuperar al reintentar.

34.6. **CUANDO** el modo sea `cursor` y lleguen ítems nuevos al inicio, **LA PAGINACIÓN NO DEBERÁ** repetir ni saltar ítems.

### Requisito 35 — Control `analytics.events`

**Historia de usuario:** Como owner de analytics, quiero eventos confiables, sin datos personales y que nunca rompan la app.

#### Criterios de aceptación

35.1. **CUANDO** una unidad con perfil `analytics` declare su plan de tracking, **EL CONTROL DEBERÁ** verificar los eventos emitidos por los flujos reales de la app con un perfil de usuario sintético.

35.2. **CADA EVENTO DEBERÁ** emitirse una vez por acción, con sus propiedades obligatorias, tipos y valores permitidos, y sin propiedades fuera del plan.

35.3. **LOS EVENTOS NO DEBERÁN** contener datos personales del usuario; un plan con propiedades cuyo nombre sugiere un dato personal **DEBERÁ** reportarse como finding determinista.

35.4. **SI** el envío de analytics falla, **LA ACCIÓN DEL USUARIO DEBERÁ** completarse igual y los reintentos **NO DEBERÁN** duplicar eventos.

35.5. **SI** sólo se detectan llamadas de tracking sin plan, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 36 — Control `ui.destructive-actions`

**Historia de usuario:** Como owner de acciones que borran, cancelan o cobran, quiero que nunca se ejecuten por accidente ni dos veces.

#### Criterios de aceptación

36.1. **CUANDO** una unidad con perfil `destructive-actions` declare sus acciones y su salvaguarda (`confirm`, `undo` o `confirm-and-undo`), **EL CONTROL DEBERÁ** verificarlas midiendo el efecto neto sobre un transporte sintético.

36.2. **CUANDO** la salvaguarda incluya confirmación, **EL PRIMER CLIC SÓLO DEBERÁ** pedir confirmación y cancelar **NO DEBERÁ** ejecutar nada.

36.3. **CUANDO** la salvaguarda incluya deshacer, **DESHACER DENTRO DE LA VENTANA DEBERÁ** dejar todo como estaba y, vencida la ventana, la acción **DEBERÁ** quedar aplicada; la ventana **DEBERÁ** declararse y ser al menos la mínima configurada.

36.4. **CUANDO** el usuario repita el clic mientras la acción está en curso, **LA ACCIÓN DEBERÁ** ejecutarse una sola vez.

36.5. **SI** la acción falla, **LA APP DEBERÁ** mostrarlo como error con un mensaje legible y nunca como éxito.

36.6. **SI** sólo se detectan llamadas de borrado o cancelación sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 37 — Control `i18n.formatting`

**Historia de usuario:** Como owner de un producto en varios idiomas o países, quiero que fechas, números y montos se vean como espera cada usuario.

#### Criterios de aceptación

37.1. **CUANDO** una unidad con perfil `localized` declare idiomas, idioma por defecto, moneda y formatos, **EL CONTROL DEBERÁ** comparar la capa de formato del equipo con las convenciones de `Intl` (ICU) sin exigir un texto exacto.

37.2. **LAS FECHAS DEBERÁN** respetar el orden de día y mes del idioma y la zona horaria del usuario; **LOS NÚMEROS** su separador decimal; **LOS MONTOS** la moneda declarada.

37.3. **SI** el idioma del usuario no está soportado, **LA APP DEBERÁ** usar el idioma por defecto; **SI** falta una traducción, **DEBERÁ** mostrar un texto legible y nunca la clave interna.

37.4. **EL IDIOMA POR DEFECTO DEBERÁ** estar entre los declarados.

37.5. **SI** sólo se detectan formatos armados a mano sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 38 — Control `app.offline-mode`

**Historia de usuario:** Como owner de una app que se usa con mala señal, quiero que el usuario no pierda lo que hace sin conexión y que nada se duplique al volver.

#### Criterios de aceptación

38.1. **CUANDO** una unidad con perfil `offline-capable` declare qué acciones deben funcionar sin red y si debe avisar, **EL CONTROL DEBERÁ** verificarlas con red, transporte y almacenamiento sintéticos.

38.2. **CUANDO** se exija aviso, **LA APP DEBERÁ** indicar que está sin conexión y quitar el aviso al volver.

38.3. **CUANDO** una acción encolable se haga sin red, **LA APP DEBERÁ** aceptarla y, al volver la conexión, enviarla exactamente una vez, en el orden en que se hizo, vaciando la cola, aunque la app se haya reiniciado entremedio.

38.4. **CUANDO** una acción sólo funcione con red, **LA APP DEBERÁ** rechazarla sin conexión y **NO DEBERÁ** enviarla después.

38.5. **SI** sólo se detectan service workers o APIs de conectividad sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 39 — Control `app.device-permissions`

**Historia de usuario:** Como owner de una app que usa cámara, ubicación o notificaciones, quiero pedir permisos sólo cuando hacen falta y que un "no" no rompa la app.

#### Criterios de aceptación

39.1. **CUANDO** una unidad con perfil `device-permissions` declare sus permisos, **EL CONTROL DEBERÁ** verificarlos con una plataforma de permisos sintética.

39.2. **AL** abrir la app, **NO DEBERÁ** pedirse ningún permiso declarado; **DEBERÁ** pedirse al usar la funcionalidad, con la explicación visible en ese momento.

39.3. **SI** el usuario niega el permiso, **LA APP DEBERÁ** seguir funcionando y, si el contrato lo exige, ofrecer una alternativa; **NO DEBERÁ** volver a pedirlo cada vez.

39.4. **SI** el permiso está bloqueado, **LA APP NO DEBERÁ** pedirlo y **DEBERÁ** ofrecer ir a los ajustes del sistema.

39.5. **SI** sólo se detectan pedidos de permiso sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 40 — Control `nav.broken-routes`

**Historia de usuario:** Como owner de una app con rutas y enlaces compartibles, quiero que un enlace roto nunca deje al usuario en una pantalla en blanco ni pierda su destino.

#### Criterios de aceptación

40.1. **CUANDO** una unidad con perfil `routed-app` declare sus rutas, **EL CONTROL DEBERÁ** verificarlas con URLs sintéticas armadas desde el contrato.

40.2. **UNA RUTA INEXISTENTE DEBERÁ** mostrar una página de "no encontrado" con una salida; **UNA URL MAL FORMADA NO DEBERÁ** romper la app.

40.3. **CUANDO** se exijan enlaces profundos, **UN ENLACE A UNA RUTA PROTEGIDA SIN SESIÓN DEBERÁ** llevar al login y, tras iniciar sesión, al destino original con sus parámetros.

40.4. **SI** sólo se detecta un router sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

40.5. **LAS URLS NO DEBERÁN** aparecer en trazas, reportes ni evidencia.

### Requisito 41 — Control `ui.accessible-dialogs`

**Historia de usuario:** Como owner de una interfaz con modales y menús, quiero que se puedan usar con teclado y lector de pantalla.

#### Criterios de aceptación

41.1. **CUANDO** una unidad con perfil `dialogs` declare sus diálogos (modal, menú o panel) y si son descartables, **EL CONTROL DEBERÁ** verificarlos según los patrones de WAI-ARIA.

41.2. **AL** abrir, **EL FOCO DEBERÁ** entrar al diálogo; en modales y paneles **DEBERÁ** quedar dentro con Tab y Shift+Tab y el fondo **DEBERÁ** quedar inactivo.

41.3. **ESCAPE Y CLIC AFUERA DEBERÁN** cerrar un diálogo descartable devolviendo el foco al botón que lo abrió, y **NO DEBERÁN** cerrar uno no descartable.

41.4. **EL DIÁLOGO DEBERÁ** tener el rol correcto y un nombre accesible.

41.5. **SI** sólo se detectan modales sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 42 — Control `api.idempotency`

**Historia de usuario:** Como owner de una API que modifica datos, quiero que un pedido repetido nunca duplique su efecto.

#### Criterios de aceptación

42.1. **CUANDO** una unidad con perfil `http-api` declare endpoints con clave de idempotencia, **EL CONTROL DEBERÁ** verificarlos llamando al handler real con dependencias sintéticas que cuentan los efectos.

42.2. **CUANDO** llegue dos veces el mismo pedido con la misma clave, en secuencia o a la vez, **LA API DEBERÁ** ejecutar el efecto una sola vez, devolver la misma respuesta y no responder 5xx.

42.3. **CUANDO** se reutilice una clave con otro cuerpo, **LA API DEBERÁ** rechazarlo (409/422) sin ejecutar nada; **CUANDO** la clave sea obligatoria y falte, **DEBERÁ** rechazarlo (400/428).

42.4. **SI** sólo se detectan endpoints que modifican datos sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

### Requisito 43 — Control `api.error-responses`

**Historia de usuario:** Como consumidor de una API, quiero errores predecibles que no expongan el interior del sistema.

#### Criterios de aceptación

43.1. **CUANDO** una unidad con perfil `http-api` declare su formato de error y endpoints con cuerpos inválidos sintéticos, **EL CONTROL DEBERÁ** verificar las respuestas de error.

43.2. **UNA ENTRADA INVÁLIDA DEBERÁ** responder 400/422; **UN JSON MAL FORMADO**, 400; **UNA RUTA INEXISTENTE**, 404; **UNA FALLA INTERNA**, un 5xx controlado.

43.3. **TODO ERROR DEBERÁ** seguir el formato declarado (`application/problem+json` o los campos declarados) y **NO DEBERÁ** exponer stack traces, rutas del servidor, SQL, IPs internas ni mensajes de dependencias, ni en el cuerpo ni en los headers.

43.4. **SI** el formato es `custom`, **EL CONTRATO DEBERÁ** declarar los campos obligatorios.

### Requisito 44 — Control `api.rate-limit`

**Historia de usuario:** Como owner de una API pública, quiero que un cliente abusivo no afecte a los demás.

#### Criterios de aceptación

44.1. **CUANDO** una unidad con perfil `http-api` declare límites por endpoint (cantidad, ventana e identidad), **EL CONTROL DEBERÁ** verificarlos con reloj virtual e identidades sintéticas.

44.2. **DENTRO DEL LÍMITE NO DEBERÁ** responderse 429; **AL SUPERARLO DEBERÁ** responderse 429 con `Retry-After` entre 1 segundo y la ventana.

44.3. **EL LÍMITE DEBERÁ** contarse por cliente y reiniciarse al pasar la ventana.

44.4. **LÍMITES MAYORES A MIL PEDIDOS POR VENTANA** quedan sin evidencia conductual y **SÓLO DEBERÁN** avisar.

### Requisito 45 — Control `api.pagination`

**Historia de usuario:** Como owner de una API con listados, quiero respuestas acotadas y paginación que no repita ni salte datos.

#### Criterios de aceptación

45.1. **CUANDO** una unidad con perfil `http-api` declare sus listados (modo, tamaños y nombres de campos), **EL CONTROL DEBERÁ** verificarlos con un almacén sintético.

45.2. **SIN PARÁMETROS DEBERÁ** devolverse el tamaño por defecto; **UN LÍMITE MAYOR AL MÁXIMO DEBERÁ** recortarse o rechazarse con 4xx; **UN LÍMITE O CURSOR INVÁLIDO NO DEBERÁ** producir 5xx.

45.3. **RECORRER TODAS LAS PÁGINAS DEBERÁ** traer todos los ítems, sin duplicados, en orden estable y con final detectable; en modo cursor, la llegada de ítems nuevos **NO DEBERÁ** repetir ni saltar ítems.

45.4. **EL MÁXIMO DECLARADO NO DEBERÁ** superar el límite configurado ni ser menor que el tamaño por defecto.

### Requisito 46 — Control `svc.dependency-failure`

**Historia de usuario:** Como owner de un servicio, quiero que la caída de una base o de un servicio externo no arrastre a todo el sistema.

#### Criterios de aceptación

46.1. **CUANDO** una unidad con perfil `backend-service` declare sus dependencias con timeout, circuit breaker y modo degradado, **EL CONTROL DEBERÁ** verificarlas reemplazándolas por dependencias sintéticas que responden, se cuelgan o fallan.

46.2. **SI** una dependencia se cuelga o falla, **EL SERVICIO DEBERÁ** responder dentro de su timeout con 503/504 controlado, o con una respuesta degradada 2xx cuando así se declare, y nunca con 500 ni una excepción.

46.3. **CUANDO** se exija circuit breaker, **EL SERVICIO DEBERÁ** dejar de llamar a la dependencia tras fallas repetidas y volver a 2xx cuando la dependencia se recupere.

46.4. **EL TIMEOUT DECLARADO NO DEBERÁ** superar el máximo configurado.

### Requisito 47 — Control `svc.health-shutdown`

**Historia de usuario:** Como owner de un servicio desplegado en un orquestador, quiero que los despliegues y reinicios no corten requests ni manden tráfico a instancias que no pueden atenderlo.

#### Criterios de aceptación

47.1. **CUANDO** una unidad con perfil `backend-service` declare liveness, readiness, dependencias, un endpoint de trabajo y el tiempo de gracia, **EL CONTROL DEBERÁ** verificarlos con dependencias sintéticas.

47.2. **LIVENESS DEBERÁ** responder 2xx mientras el proceso funciona, sin depender de las dependencias; **READINESS DEBERÁ** responder 2xx con todo sano y 503 si una dependencia declarada no responde.

47.3. **AL** recibir la señal de apagado, **EL SERVICIO DEBERÁ** terminar las requests en curso, dejar de estar "ready", rechazar las nuevas con 503 y terminar dentro del tiempo de gracia, aunque haya trabajo que no termina.

47.4. **EL TIEMPO DE GRACIA NO DEBERÁ** superar el máximo configurado.

### Requisito 48 — Control `svc.log-hygiene`

**Historia de usuario:** Como owner de un servicio, quiero logs útiles para diagnosticar que nunca expongan datos de los usuarios ni secretos.

#### Criterios de aceptación

48.1. **CUANDO** una unidad con perfil `backend-service` declare el formato de sus logs, el header de correlación y endpoints a ejercitar, **EL CONTROL DEBERÁ** capturar la salida del logger real mientras atiende requests sintéticas.

48.2. **CADA LÍNEA DE LOG DEBERÁ** ser un objeto JSON con los campos declarados de nivel y mensaje.

48.3. **TODAS LAS LÍNEAS DE UNA REQUEST DEBERÁN** llevar el id de correlación recibido en el header declarado o, si no llegó, un id generado y estable para esa request.

48.4. **LOS LOGS NO DEBERÁN** contener datos personales (email, teléfono, tarjeta) ni secretos (tokens, cookies, contraseñas) presentes en cuerpo, headers, query o mensajes de error.

48.5. **CUANDO** una dependencia falle, **DEBERÁ** registrarse un evento de nivel error.

48.6. **SI** sólo se detectan llamadas a loggers sin contrato, **EL CONTROL DEBERÁ** emitir como máximo `warn`.

## 7. Matriz mínima de aplicabilidad

| Control | Perfil requerido | Momentos mínimos | Evidencia apta para `deny` | Heurística permitida |
|---|---|---|---|---|
| `search.input-rate` | `search` | agent, PR; release cuando aplique | Tests de comportamiento reproducibles fallidos para cadencia, mínimo, cancelación/orden o dedupe | Detección de handlers, llamadas, dependencias o patrones |
| `app.minimum-supported-version` | `mobile-app` | PR, release | Schema/contrato inválido o tests deterministas fallidos de semver, offline, hard/soft, stores, rollback u override | Inferencia de config remota o flujos por nombres/AST incompleto |
| `web.module-announcement` | `web` + `module-launch` | agent, PR, release | Señal requerida ausente según declaración explícita, metadata inválida, N/A inválido o tests contractuales fallidos | Inferencia de “módulo nuevo” por rutas, componentes o diff |
| `ui.data-states` | `data-views` | agent, PR, release | Contrato inválido o escenarios fallidos de carga, vacío, error, reintento, timeout o carga duplicada | Detección de llamadas de red o librerías de datos |
| `ui.form-validation` | `forms` | agent, PR, release | Contrato inválido o escenarios fallidos de validación, errores accesibles, doble envío o pérdida de lo escrito | Detección de formularios por patrón |
| `net.resilient-requests` | `network-client` | agent, PR, release | Contrato inválido o inseguro, o escenarios fallidos de timeout, reintento, backoff, Retry-After o idempotencia | Detección de llamadas HTTP por patrón |
| `flags.lifecycle` | `feature-flags` | agent, PR, release | Registro inválido, flag vencida o sin retiro, vida excesiva, default inseguro o escenarios fallidos del cliente | Detección de uso de SDK de flags |
| `auth.session-expiry` | `auth-session` | agent, PR, release | Contrato inválido o escenarios fallidos de renovación, bucle, login o trabajo conservado | Detección de manejo de tokens o 401 |
| `ui.file-upload` | `file-upload` | agent, PR, release | Contrato inválido o permisivo, o escenarios fallidos de límites, progreso, cancelación, reintento o subida doble | Detección de inputs de archivo |
| `ui.pagination` | `paginated-lists` | agent, PR, release | Contrato inválido o escenarios fallidos de páginas, duplicados, orden, fin, concurrencia, errores o cursor | Detección de listas infinitas o paginadas |
| `analytics.events` | `analytics` | agent, PR, release | Plan inválido o con propiedades personales, o escenarios fallidos de esquema, duplicados, fuga de PII o aislamiento | Detección de llamadas de tracking |
| `ui.destructive-actions` | `destructive-actions` | agent, PR, release | Contrato inválido o escenarios fallidos de confirmación, cancelación, deshacer, ejecución doble o error | Detección de llamadas de borrado o cancelación |
| `i18n.formatting` | `localized` | agent, PR, release | Contrato inválido o escenarios fallidos de fecha, número, moneda, zona horaria, respaldo o traducción ausente | Detección de formatos armados a mano |
| `app.offline-mode` | `offline-capable` | agent, PR, release | Contrato inválido o escenarios fallidos de aviso, cola, sincronización, persistencia, orden o acciones online-only | Detección de service workers o APIs de conectividad |
| `app.device-permissions` | `device-permissions` | agent, PR, release | Contrato inválido o escenarios fallidos de momento del pedido, explicación, rechazo, insistencia o bloqueo | Detección de APIs de permisos |
| `nav.broken-routes` | `routed-app` | agent, PR, release | Contrato inválido o escenarios fallidos de ruta, "no encontrado", URL mal formada o destino tras el login | Detección de routers |
| `ui.accessible-dialogs` | `dialogs` | agent, PR, release | Contrato inválido o escenarios fallidos de foco, teclado, cierre, rol, nombre o fondo inerte | Detección de modales por patrón |
| `api.idempotency` | `http-api` | PR, release | Contrato inválido o escenarios fallidos de repetición, concurrencia, clave reutilizada o clave faltante | Detección de endpoints que modifican datos |
| `api.error-responses` | `http-api` | PR, release | Contrato inválido o escenarios fallidos de código, formato o fuga de detalles internos | Detección de handlers HTTP |
| `api.rate-limit` | `http-api` | PR, release | Contrato inválido o escenarios fallidos de límite, 429, Retry-After, conteo por cliente o ventana | Detección de endpoints públicos |
| `api.pagination` | `http-api` | PR, release | Contrato inválido o incoherente, o escenarios fallidos de tamaños, recorrido, cursor o parámetros inválidos | Detección de consultas de listado |
| `svc.dependency-failure` | `backend-service` | PR, release | Contrato inválido o escenarios fallidos de timeout, respuesta ante fallas o circuit breaker | Detección de clientes de bases o servicios |
| `svc.health-shutdown` | `backend-service` | PR, release | Contrato inválido o escenarios fallidos de liveness, readiness o apagado ordenado | Detección del arranque del servidor |
| `svc.log-hygiene` | `backend-service` | PR, release | Contrato inválido o escenarios fallidos de formato, correlación, datos personales, secretos o log de error | Detección de llamadas a loggers |

La tabla define mínimos; el catálogo podrá ampliar momentos o evidencia sin contradecir la regla de que las heurísticas nunca bloquean.

## 8. Riesgos y mitigaciones obligatorias

| Riesgo | Consecuencia | Mitigación requerida |
|---|---|---|
| Falsos positivos | Pérdida de confianza y bypasses | Warning para heurísticas, enforcement sólo determinista, métricas y rollback |
| Falsos negativos | Omisiones llegan a producción | Perfiles explícitos, tests de comportamiento, PR/release y auditoría de cobertura |
| Perfil incorrecto | Controles irrelevantes o ausentes | Declaración por unidad, sugerencias no autoritativas y aplicabilidad explicada |
| Drift de catálogo | Resultados distintos entre local y CI | Versiones inmutables, resolución fija y evidencia de versión |
| Flakiness | Bloqueos no reproducibles | Reloj/transporte controlables, retries observados, suite de determinismo |
| Sobrecosto | Hooks lentos y CI congestionado | Presupuestos por momento, incrementalidad, cache vinculada y timeouts |
| Monorepo mal acotado | Unidades omitidas o sobrebloqueadas | Mapeo explícito, grafo de impacto y ampliación ante ambigüedad |
| Dependencia de proveedor | Lock-in y política divergente | CLI/JSON/exit code provider-neutral y adaptadores delgados |
| Fuga de datos | Exposición en reportes o telemetría | Minimización, redacción, canarios, opt-in y retención mínima |
| Hard update defectuoso | Usuarios bloqueados sin salida | Fuente confiable, cache/offline, gracia, rollback y emergency override |
| Announcement intrusivo | Daño de UX/accesibilidad | Audiencias/canales explícitos, show-once, tests a11y y rollback |
| Waivers permanentes | Deuda invisible | Alcance mínimo, owner, aprobación, expiración y auditoría |
| Cambio de protocolo | Cobertura de agente falsa | Matriz de compatibilidad y auditoría de linkage real |
| Error tratado como éxito | Falsa conformidad | `error/unavailable/unknown` explícitos; nunca `allow` fabricado |

## 9. Supuestos y dependencias

- `kiritek-init` seguirá ofreciendo un contrato `PolicyResult` común y configuración validada.
- Los adaptadores de Kiro y Claude pueden evolucionar independientemente del motor.
- Los tests de comportamiento son propiedad del producto o de harnesses controlados; el pack no presume un framework de test único.
- Las fuentes remotas de versión mínima, stores y canales de announcement se modelan mediante interfaces inyectables; esta spec no obliga a un proveedor.
- La protección final compartida depende de CI/release porque hooks y agentes locales pueden omitirse.

## 10. Trazabilidad resumida

| Objetivo | Requisitos |
|---|---|
| Separación, contratos y configuración | 1, 3, 4 |
| Perfiles, aplicabilidad y monorepo | 2, 5, 14 |
| Collectors, evaluators, evidencia y bloqueo seguro | 6, 7, 8 |
| Controles iniciales | 9, 10, 11 |
| Superficies agent/Git/CI/release | 12, 13, 17 |
| Privacidad, performance y observabilidad | 15, 16, 20 |
| Excepciones, rollout y lifecycle | 18, 21, 22 |
| Extensibilidad, compatibilidad y documentación | 23, 24, 25 |
| Pruebas y aceptación global | 26, 27 |
