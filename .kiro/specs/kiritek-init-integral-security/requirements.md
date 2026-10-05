# Requirements — Controles integrales de seguridad para `kiritek-init`

## 1. Propósito

Esta Quick Spec define los requisitos para que `kiritek-init` instale, actualice, ejecute y audite un baseline portable de seguridad por defecto, con controles locales, hooks Git, adaptadores para asistentes de IA y gates de CI. El baseline debe proteger repositorios nuevos y existentes sin destruir personalizaciones, mantener controles especializados por stack y ofrecer packs opcionales desacoplados para AWS CodeCommit y GitHub.

El objetivo no es afirmar seguridad por la mera presencia de archivos, sino aportar controles ejecutables, versiones y configuración verificables, resultados redactados, evidencias trazables y un rollout gradual de advertencia a enforcement.

## 2. Contexto y brechas observadas

El estado actual de `kiritek-init` condiciona estos requisitos:

- El core sólo instala artefactos Claude, `.graphifyignore` y una configuración de auditoría basada principalmente en existencia de rutas.
- `update` vuelve a ejecutar `init`; los archivos existentes se omiten y las correcciones de seguridad no se propagan.
- No existen Gitleaks, hooks Git administrados, hooks/adaptadores Kiro, gates de seguridad de CI ni validadores ejecutables de Jira.
- Las reglas Git actuales son orientación para agentes, no enforcement técnico.
- La automatización de seguridad más completa está dentro del stack Flutter; produce reportes JSON y debe conservarse como control OWASP móvil especializado, no como baseline genérico.
- El workflow semanal de auditoría hace commit y push directo desde CI.
- La instalación actual ejecuta dependencias remotas mutables y comandos orientados a Unix sin validación suficiente de versión, integridad o plataforma.

## 3. Alcance

### 3.1 Incluido

- Baseline `core/security` instalado por defecto.
- Detección de secretos con Gitleaks y configuración portable.
- Hooks Git versionados, idempotentes y compatibles con hooks existentes.
- Adaptadores separados para Claude Code y Kiro.
- Políticas Git, Conventional Commits y Jira.
- Controles CI portables y adaptadores opcionales de proveedor.
- Auditoría por capacidades, versiones, configuración, ejecución y estado.
- Reportes seguros, observabilidad, respuesta a incidentes y rotación.
- Migración y actualización segura de instalaciones existentes.
- Pruebas, documentación, compatibilidad y supply chain.

### 3.2 Fuera de alcance

- Detectores o clasificadores de autoría por IA como gate de commit, push, PR, merge o release.
- Sustituir una revisión profesional, pentest o programa corporativo de gestión de vulnerabilidades.
- Guardar secretos reales como fixtures de prueba.
- Hacer obligatoria una plataforma única de hosting, CI, cloud o asistente de IA.

## 4. Glosario

- **Baseline:** controles genéricos independientes del stack y del proveedor.
- **Core de seguridad:** artefactos administrados bajo `core/security`, instalados por defecto.
- **Adaptador:** integración del core con Git, Claude Code, Kiro, GitHub o AWS sin duplicar la lógica de política.
- **Rama default:** rama primaria detectada dinámicamente; no se presume `main` ni `master`.
- **Rango enviado:** commits que un `git push` enviaría al remoto, considerando cada refspec y su upstream.
- **Modo warning:** ejecuta y reporta, pero no bloquea salvo peligros críticos expresamente definidos.
- **Modo enforcement:** bloquea al incumplir una política habilitada.
- **Evidencia:** comando, timestamp, versión/configuración, alcance, resultado, exit code y referencia inmutable o suficientemente trazable.
- **Placeholder seguro:** valor inequívocamente ficticio, por ejemplo `YOUR_API_KEY`, `EXAMPLE_TOKEN`, `<REPLACE_ME>` o valores reservados de fixtures.
- **Break-glass:** excepción excepcional, autorizada, justificada, expirable y auditable; no equivale a `--no-verify`.

## 5. Requisitos y criterios de aceptación

### Requisito 1 — Core de seguridad portable por defecto

**Historia de usuario:** Como mantenedor de un repositorio, quiero recibir un baseline de seguridad independiente del stack para que todos los proyectos tengan una protección mínima consistente.

#### Criterios de aceptación

1.1. **CUANDO** se ejecute `kiritek-init init` sin deshabilitar explícitamente seguridad, **EL CLI DEBERÁ** instalar el pack administrado `core/security` y sus comandos, configuración, políticas, documentación y adaptadores Git aplicables.

1.2. **MIENTRAS** no se seleccione ningún stack, **EL CORE DE SEGURIDAD DEBERÁ** seguir siendo completamente instalable y ejecutable.

1.3. **DONDE** un control sea genérico, **EL INSTALADOR DEBERÁ** ubicarlo en `core/security` y no dentro de Flutter, Express u otro stack.

1.4. **CUANDO** se use `--security=off`, **EL CLI DEBERÁ** exigir una elección explícita, mostrar las protecciones omitidas, registrar la decisión y no presentar la instalación como conforme al baseline.

1.5. **CUANDO** se complete la instalación, **EL CLI DEBERÁ** mostrar qué controles quedaron activos, advertidos, no disponibles, deshabilitados o pendientes de configuración.

1.6. **SI** el proyecto no es un repositorio Git, **EL CLI DEBERÁ** instalar los archivos portables que no dependan de Git y reportar de forma accionable qué hooks y escaneos no pueden activarse todavía.

### Requisito 2 — Gitleaks fijado, íntegro y portable

**Historia de usuario:** Como desarrollador, quiero una versión reproducible de Gitleaks para obtener resultados consistentes localmente y en CI.

#### Criterios de aceptación

2.1. **CUANDO** el core configure Gitleaks, **EL SISTEMA DEBERÁ** fijar una versión exacta en un manifiesto administrado, sin rangos, tags flotantes ni dependencia implícita de `latest`.

2.2. **CUANDO** el CLI descargue o use un binario administrado, **EL SISTEMA DEBERÁ** verificar versión, plataforma, arquitectura y checksum publicado antes de ejecutarlo.

2.3. **SI** existe un Gitleaks del sistema, **EL CLI DEBERÁ** validar su versión contra la política y, según configuración, reutilizarlo o usar la versión administrada sin reemplazar software global silenciosamente.

2.4. **CUANDO** se instale la configuración de Gitleaks, **EL SISTEMA DEBERÁ** proporcionar una configuración portable con reglas core, allowlists acotadas, extensiones del proyecto y documentación de precedencia.

2.5. **SI** una configuración local personalizada extiende la configuración core, **EL EJECUTOR DEBERÁ** aplicar ambas de forma determinista y auditable sin editar la personalización del usuario.

2.6. **CUANDO** la plataforma no tenga un binario compatible o la descarga esté prohibida, **EL CLI DEBERÁ** fallar de forma accionable en enforcement o marcar el control como no disponible en warning; nunca deberá simular que el escaneo ocurrió.

2.7. **CUANDO** se ejecute Gitleaks, **EL SISTEMA DEBERÁ** capturar la versión efectiva y el hash de la configuración en la evidencia.

### Requisito 3 — Alcance correcto del escaneo de secretos

**Historia de usuario:** Como equipo, quiero escaneos adecuados a cada etapa para bloquear secretos temprano y revisar el historial relevante.

#### Criterios de aceptación

3.1. **CUANDO** se ejecute `pre-commit`, **EL HOOK DEBERÁ** escanear únicamente el contenido staged que formaría parte del commit, incluidas adiciones, modificaciones y renombres, sin depender del contenido unstaged.

3.2. **CUANDO** se ejecute `pre-push`, **EL HOOK DEBERÁ** calcular por refspec el rango de commits enviado y escanear todos los objetos nuevos del rango, incluidas ramas sin upstream y pushes de múltiples refs.

3.3. **SI** el push crea una rama remota nueva, **EL HOOK DEBERÁ** calcular una base segura contra el remoto o, si no puede determinarla, ampliar el alcance y reportar la decisión sin omitir silenciosamente commits.

3.4. **CUANDO** corra CI en un pull request, **EL JOB DEBERÁ** escanear el rango completo del cambio con historial suficiente y sin exponer secretos de contextos confiables a código no confiable.

3.5. **CUANDO** corra CI en la rama default, por schedule o manualmente con permiso, **EL JOB DEBERÁ** escanear el repositorio y el historial según una profundidad configurable, con opción explícita de historial completo.

3.6. **CUANDO** un escaneo encuentre un secreto, **EL SISTEMA DEBERÁ** devolver un exit code no cero en enforcement y un resultado estructurado redactado en warning.

3.7. **SI** un hallazgo está en historial ya publicado, **EL SISTEMA DEBERÁ** distinguir remediación del archivo, revocación/rotación y, cuando proceda, reescritura coordinada de historial.

3.8. **CUANDO** se utilice un baseline de hallazgos conocidos, **EL SISTEMA DEBERÁ** identificarlo por fingerprint, exigir propietario, justificación y expiración, y bloquear secretos nuevos fuera del baseline.

### Requisito 4 — Hooks Git versionados e instalación no destructiva

**Historia de usuario:** Como mantenedor de un repositorio existente, quiero activar hooks sin perder automatizaciones previas.

#### Criterios de aceptación

4.1. **CUANDO** se instalen hooks Git, **EL INSTALADOR DEBERÁ** almacenar scripts/versiones administradas dentro del repositorio y registrar la versión del pack aplicada.

4.2. **SI** existen hooks nativos, `core.hooksPath`, Husky, Lefthook, pre-commit, CaptainHook u otro gestor reconocido, **EL INSTALADOR DEBERÁ** detectarlo y encadenar o adaptar Kiritek sin truncar, sobrescribir ni deshabilitar los hooks existentes.

4.3. **CUANDO** la instalación se repita, **EL RESULTADO DEBERÁ** ser idempotente: una sola invocación por hook, sin líneas, shims ni configuraciones duplicadas.

4.4. **SI** no existe una estrategia segura de composición, **EL INSTALADOR DEBERÁ** detener la activación automática, conservar el estado previo y emitir instrucciones/diff para integración manual.

4.5. **CUANDO** un hook Kiritek invoque un hook previo, **EL DISPATCHER DEBERÁ** preservar argumentos, stdin y exit code según la semántica del hook.

4.6. **CUANDO** falle parcialmente la instalación de hooks, **EL INSTALADOR DEBERÁ** restaurar la configuración Git y archivos previos o indicar un rollback verificable.

4.7. **CUANDO** se desinstale o desactive Kiritek, **EL CLI DEBERÁ** retirar sólo artefactos Kiritek y dejar operativos los hooks preexistentes.

4.8. **MIENTRAS** el repositorio use worktrees o rutas con espacios, **LOS HOOKS DEBERÁN** resolver la raíz y rutas sin asumir el directorio actual ni concatenar argumentos sin escape.

### Requisito 5 — Protección de archivos sensibles y ejemplos permitidos

**Historia de usuario:** Como desarrollador, quiero bloquear credenciales reales sin impedir documentación y archivos de ejemplo seguros.

#### Criterios de aceptación

5.1. **CUANDO** Git, Claude Code o Kiro intenten incluir, leer para contexto, escribir o enviar contenido sensible según la capacidad del adaptador, **LA POLÍTICA DEBERÁ** proteger `.env`, `.env.*`, PEM, certificados privados, archivos `*.key`, patrones de credenciales, `credentials.json` y cualquier contenido bajo `secrets/`.

5.2. **DONDE** existan archivos de ejemplo como `.env.example`, `.env.sample`, plantillas o fixtures, **LA POLÍTICA DEBERÁ** permitirlos únicamente si contienen placeholders seguros y ningún detector identifica material secreto real.

5.3. **SI** un archivo permitido por nombre contiene un secreto detectable, **EL CONTROL DEBERÁ** bloquearlo; la allowlist por ruta nunca deberá anular automáticamente el análisis de contenido.

5.4. **CUANDO** se bloquee una operación, **EL MENSAJE DEBERÁ** identificar política y ruta, pero redactar el valor sensible y evitar copiar la línea completa si pudiera contener el secreto.

5.5. **CUANDO** el usuario necesite una excepción, **EL SISTEMA DEBERÁ** requerir una regla mínima y específica, razón, propietario y expiración; no deberá aceptar allowlists globales silenciosas.

5.6. **CUANDO** se creen fixtures para pruebas, **EL SISTEMA DEBERÁ** usar valores reservados/no funcionales y verificar que no activan credenciales reales.

### Requisito 6 — Adaptadores separados para Claude Code y Kiro

**Historia de usuario:** Como usuario de distintos asistentes, quiero la misma política de seguridad adaptada a las capacidades reales de cada herramienta.

#### Criterios de aceptación

6.1. **CUANDO** se habilite Claude Code, **EL INSTALADOR DEBERÁ** instalar un adaptador Claude separado del core, usando mecanismos soportados por Claude y sin depender de Kiro.

6.2. **CUANDO** se habilite Kiro, **EL INSTALADOR DEBERÁ** instalar un adaptador Kiro separado del core, usando mecanismos soportados por Kiro y sin depender de Claude Code.

6.3. **CUANDO** ambos adaptadores estén activos, **EL SISTEMA DEBERÁ** reutilizar la misma política central y evitar ejecuciones duplicadas o resultados contradictorios.

6.4. **CUANDO** un asistente proponga una operación de archivo o comando Git protegible, **EL ADAPTADOR DEBERÁ** evaluar la operación antes de ejecutarla y bloquearla en enforcement cuando viole las políticas de secretos o Git.

6.5. **SI** la versión instalada del asistente no soporta una capacidad requerida, **LA AUDITORÍA DEBERÁ** marcar esa capa como no disponible y no atribuirle protección inexistente.

6.6. **CUANDO** cambie la API de hooks de un asistente, **LA ACTUALIZACIÓN DEBERÁ** migrar únicamente el adaptador afectado y conservar el core compartido.

6.7. **CUANDO** el adaptador registre eventos, **EL REGISTRO DEBERÁ** excluir prompts, código y valores sensibles salvo consentimiento explícito y redacción verificable.

### Requisito 7 — Guardas de comandos Git peligrosos

**Historia de usuario:** Como equipo, quiero evitar bypasses y pushes destructivos o directos a la rama protegida.

#### Criterios de aceptación

7.1. **CUANDO** un usuario o asistente intente `git push` directo a la rama default, **EL ADAPTADOR/HOOK DEBERÁ** bloquearlo en enforcement y recomendar un pull request.

7.2. **CUANDO** un comando use `--force`, `-f`, refspec con `+` u otra forma equivalente de push no fast-forward, **EL CONTROL DEBERÁ** bloquearlo salvo un flujo break-glass autorizado; `--force-with-lease` deberá evaluarse según política y no asumirse siempre seguro.

7.3. **CUANDO** un comando Git use `--no-verify`, **EL CONTROL DEBERÁ** bloquearlo en los adaptadores Claude/Kiro y reportarlo como bypass no permitido.

7.4. **SI** un usuario ejecuta Git fuera del alcance de los adaptadores, **EL SISTEMA DEBERÁ** documentar que ningún hook cliente puede impedir todos los bypasses y deberá apoyarse en controles remotos para el enforcement final.

7.5. **CUANDO** se use break-glass para un push permitido, **EL SISTEMA DEBERÁ** exigir identidad autorizada, motivo, ticket/incidente, alcance, expiración y evidencia posterior; nunca deberá implementarlo mediante `--no-verify`.

7.6. **CUANDO** se trate de tags, borrado de refs o pushes múltiples, **EL CONTROL DEBERÁ** evaluar cada actualización de ref y aplicar la política correspondiente sin asumir que todas son ramas normales.

### Requisito 8 — Detección dinámica de rama default

**Historia de usuario:** Como equipo con convenciones diversas, quiero que las políticas protejan la rama correcta sin hardcodear `main`.

#### Criterios de aceptación

8.1. **CUANDO** se necesite la rama default, **EL SISTEMA DEBERÁ** resolverla con precedencia documentada: configuración explícita, symbolic ref del remoto, API del proveedor disponible y fallback local verificable.

8.2. **SI** el repositorio usa `main`, `master`, `trunk`, `develop` u otro nombre, **LAS POLÍTICAS DEBERÁN** usar el valor detectado sin requerir cambios de código.

8.3. **SI** fuentes de detección discrepan, **EL SISTEMA DEBERÁ** detener enforcement sobre operaciones ambiguas o usar la configuración explícita, mostrando las fuentes en conflicto.

8.4. **SI** no puede detectarse una rama default, **EL SISTEMA DEBERÁ** solicitar/configurarla en modo interactivo o fallar con instrucción accionable en modo no interactivo; nunca deberá asumir silenciosamente `main`.

8.5. **CUANDO** cambie la rama default remota, **LA AUDITORÍA DEBERÁ** detectar drift respecto de la configuración/cache local.

### Requisito 9 — Conventional Commits y Jira local

**Historia de usuario:** Como equipo, quiero validar trazabilidad básica antes de compartir cambios.

#### Criterios de aceptación

9.1. **CUANDO** se cree un commit, **EL HOOK `commit-msg` DEBERÁ** validar Conventional Commits, incluidos tipos configurables, scope opcional, breaking changes y límites de longitud definidos.

9.2. **CUANDO** Jira esté habilitado, **EL SISTEMA DEBERÁ** aceptar una expresión configurable para claves, con un default equivalente a claves Jira estándar, y validar su presencia en las ubicaciones configuradas de rama, commit o PR.

9.3. **SI** Jira está deshabilitado, **LOS VALIDADORES DEBERÁN** omitir la exigencia de clave sin deshabilitar Conventional Commits ni controles de secretos.

9.4. **CUANDO** se configure una excepción como `NO-JIRA`, **EL SISTEMA DEBERÁ** limitarla por tipo de cambio/rol, exigir razón y conservar evidencia; no deberá funcionar como bypass universal.

9.5. **CUANDO** se valide localmente una clave Jira, **EL CONTROL DEBERÁ** distinguir validación sintáctica de validación remota de existencia y no presentar la primera como prueba de existencia.

9.6. **SI** un merge/revert automático tiene formato distinto, **LA POLÍTICA DEBERÁ** definir explícitamente si se permite y aportar fixtures positivos y negativos.

### Requisito 10 — Existencia remota de Jira y fallback

**Historia de usuario:** Como equipo, quiero impedir referencias a tickets inexistentes sin quedar bloqueado de manera impredecible por una caída externa.

#### Criterios de aceptación

10.1. **CUANDO** Jira esté habilitado y se ejecute `pre-push`, **EL SISTEMA DEBERÁ** consultar por API/MCP configurable la existencia y accesibilidad de cada clave nueva del rango enviado, con timeout, caché acotada y rate limiting.

10.2. **CUANDO** Jira esté habilitado en CI, **EL JOB DEBERÁ** revalidar remotamente las claves asociadas al cambio y registrar sólo identificadores/metadatos mínimos no sensibles.

10.3. **SI** Jira responde que una clave no existe o no cumple la política configurada, **EL CONTROL DEBERÁ** bloquear en enforcement.

10.4. **SI** Jira está temporalmente no disponible, **EL FALLBACK DEBERÁ** ser configurable entre `fail-closed` y `warn`; el default en enforcement y CI deberá ser `fail-closed`, y el default durante rollout warning deberá permitir continuar con advertencia auditable.

10.5. **CUANDO** se use fallback `warn`, **EL RESULTADO DEBERÁ** quedar como `no_verificado_remotamente`, nunca como `verificado`.

10.6. **SI** faltan credenciales Jira en un entorno donde la validación es obligatoria, **EL SISTEMA DEBERÁ** fallar sin imprimir credenciales y explicar cómo configurarlas mediante el secret store del entorno.

10.7. **CUANDO** se almacene caché de Jira, **EL SISTEMA DEBERÁ** registrar expiración y tenant/base URL, y no reutilizar resultados entre instancias Jira distintas.

### Requisito 11 — Estados verificados y evidencia

**Historia de usuario:** Como auditor, quiero que las afirmaciones de verificación estén respaldadas por evidencia reproducible.

#### Criterios de aceptación

11.1. **CUANDO** una plantilla, reporte, agente o CLI use los estados `verificado`, `tested`, `working`, `cumple` o equivalentes, **EL SISTEMA DEBERÁ** exigir evidencia asociada de ejecución exitosa y alcance.

11.2. **SI** no existe evidencia, **EL ESTADO DEBERÁ** ser `no ejecutado`, `no verificado`, `parcial`, `warning` o `fallido`, según corresponda.

11.3. **CUANDO** se genere evidencia, **EL SISTEMA DEBERÁ** incluir timestamp, comando/control, versión, configuración o hash, alcance, exit code y ubicación del resultado redactado.

11.4. **SI** una evidencia ha expirado, corresponde a otro commit o no cubre el alcance declarado, **EL SISTEMA DEBERÁ** impedir que sustente el estado `verificado`.

11.5. **CUANDO** una validación manual especializada sea necesaria, **EL SISTEMA DEBERÁ** identificar revisor, checklist, fecha, alcance y referencia de aprobación sin afirmar automatización inexistente.

### Requisito 12 — Seguridad genérica fuera de Flutter y OWASP móvil preservado

**Historia de usuario:** Como mantenedor multi-stack, quiero separar controles transversales de controles móviles especializados.

#### Criterios de aceptación

12.1. **CUANDO** se migre la detección genérica de secretos, **EL SISTEMA DEBERÁ** moverla al core y hacer que Flutter la consuma o complemente, sin mantener dos gates genéricos divergentes.

12.2. **MIENTRAS** Flutter esté instalado, **EL PACK FLUTTER DEBERÁ** conservar controles OWASP Mobile especializados para dependencias, red, almacenamiento y revisiones manuales aplicables.

12.3. **CUANDO** un scanner móvil produzca resultados, **EL SCANNER DEBERÁ** redactar valores sensibles, líneas, headers, URLs con credenciales y payloads antes de persistir o imprimir.

12.4. **CUANDO** un control Flutter se describa como CVE/dependencia vulnerable, **EL SISTEMA DEBERÁ** basarlo en una fuente de advisories verificable o describirlo con precisión como heurística de versión, sin afirmar CVEs no consultados.

12.5. **CUANDO** se ejecute un proyecto no Flutter, **EL SISTEMA DEBERÁ** omitir controles móviles como `no aplicables`, no como fallidos.

12.6. **CUANDO** se agreguen packs de stack futuros, **EL SISTEMA DEBERÁ** integrarlos mediante la misma interfaz de resultados, severidad, redacción y evidencia.

### Requisito 13 — Reportes, ignores y privacidad

**Historia de usuario:** Como desarrollador, quiero resultados útiles que no creen una segunda filtración.

#### Criterios de aceptación

13.1. **CUANDO** se generen reportes, **EL SISTEMA DEBERÁ** escribirlos en un directorio configurable y administrado, separado de código fuente y excluido por defecto de Git y de indexadores de IA.

13.2. **CUANDO** instale reglas de `.gitignore`, `.graphifyignore` u otros ignores, **EL INSTALADOR DEBERÁ** fusionar entradas marcadas como Kiritek sin borrar, reordenar destructivamente ni duplicar reglas del usuario.

13.3. **CUANDO** un reporte contenga hallazgos, **EL SISTEMA DEBERÁ** omitir o redactar secretos, PII y fragmentos suficientes para reconstruir credenciales.

13.4. **CUANDO** CI publique artefactos, **EL JOB DEBERÁ** aplicar retención mínima configurable, acceso apropiado y una comprobación de redacción previa.

13.5. **CUANDO** se generen formatos humano y máquina, **EL SISTEMA DEBERÁ** usar un esquema versionado, exit codes consistentes, fingerprints estables y estados `nuevo`, `existente`, `resuelto`, `suprimido` o `error`.

13.6. **SI** se envían métricas fuera del repositorio, **EL SISTEMA DEBERÁ** requerir opt-in, TLS, autenticación, minimización, timeout, protección frente a replay/duplicados, política de retención y documentación del destino.

13.7. **SI** falla el reporte remoto, **EL SISTEMA DEBERÁ** conservar el resultado local; no obstante, no deberá marcar como entregada una métrica que no recibió confirmación.

13.8. **CUANDO** logs o comentarios de PR resuman hallazgos, **EL SISTEMA DEBERÁ** mostrar categoría, ruta redactada y remediación, nunca el valor detectado.

### Requisito 14 — Auditoría por capas y capacidades reales

**Historia de usuario:** Como responsable de seguridad, quiero conocer qué protección funciona realmente, no sólo qué archivo existe.

#### Criterios de aceptación

14.1. **CUANDO** se ejecute `kiritek-init audit`, **EL AUDITOR DEBERÁ** evaluar por control las capas: `instalado`, `versión`, `integridad`, `configurado`, `activado`, `ejecutable`, `última ejecución`, `resultado` y `enforcement`.

14.2. **CUANDO** audite Gitleaks, **EL AUDITOR DEBERÁ** ejecutar o validar un self-check seguro, comparar versión fijada y efectiva, verificar checksum/configuración y confirmar cobertura de hooks/CI.

14.3. **CUANDO** audite hooks, **EL AUDITOR DEBERÁ** comprobar configuración Git efectiva, ejecutabilidad, cadena con hooks existentes, versión y ausencia de duplicados.

14.4. **CUANDO** audite Claude/Kiro, **EL AUDITOR DEBERÁ** validar que el adaptador es compatible con la versión instalada y que las políticas relevantes están realmente enlazadas.

14.5. **CUANDO** audite CI o proveedor remoto, **EL AUDITOR DEBERÁ** distinguir entre `configuración local presente`, `configuración remota observada`, `no accesible` y `no aplicable`.

14.6. **SI** un archivo existe pero está vacío, alterado, obsoleto, no ejecutable o desconectado, **EL AUDITOR DEBERÁ** marcar la capa correspondiente como fallida o drift.

14.7. **CUANDO** finalice la auditoría, **EL SISTEMA DEBERÁ** producir salida humana y JSON estable, un resumen por severidad/capa, exit code documentado y evidencia redactada.

14.8. **CUANDO** una capacidad no pueda verificarse, **EL AUDITOR DEBERÁ** decir `desconocido/no verificable` y explicar por qué; nunca deberá inferir cumplimiento por existencia.

14.9. **CUANDO** mida adopción de Conventional Commits, **EL AUDITOR DEBERÁ** mantenerla separada del cumplimiento de secretos y no usar esa tasa como proxy de seguridad integral.

### Requisito 15 — CI portable y workflow de auditoría seguro

**Historia de usuario:** Como equipo con distintos proveedores CI, quiero ejecutar la misma política sin acoplarla a GitHub Actions.

#### Criterios de aceptación

15.1. **CUANDO** se instale el core, **EL SISTEMA DEBERÁ** proporcionar comandos CI no interactivos y provider-neutral que acepten rango, evento, rama default, modo y directorio de resultados mediante flags/variables documentadas.

15.2. **CUANDO** un adaptador CI invoque controles, **EL ADAPTADOR DEBERÁ** delegar en los mismos comandos/políticas usados localmente y no reimplementar reglas de detección.

15.3. **CUANDO** corra en PR, push a default, schedule o ejecución manual, **EL PIPELINE DEBERÁ** seleccionar el alcance definido en el Requisito 3.

15.4. **CUANDO** se instale o corrija el workflow de auditoría, **EL WORKFLOW NO DEBERÁ** hacer commit ni push directo a la rama default.

15.5. **CUANDO** la auditoría necesite persistir resultados, **EL WORKFLOW DEBERÁ** usar artefactos, sistema de observabilidad, issue o PR automatizado sujeto a controles, según configuración.

15.6. **CUANDO** se genere un workflow, **EL SISTEMA DEBERÁ** aplicar permisos mínimos, timeouts, concurrency, manejo seguro de forks, acciones/dependencias fijadas de forma inmutable y ausencia de secretos en contextos no confiables.

15.7. **SI** el checkout no tiene historial suficiente para el alcance requerido, **EL JOB DEBERÁ** obtenerlo explícitamente o fallar; no deberá reducir el escaneo silenciosamente.

15.8. **CUANDO** el CI no soporte una característica de reporte, **EL COMANDO CORE DEBERÁ** conservar JSON y exit code portables como mínimo común.

### Requisito 16 — Pack opcional AWS CodeCommit

**Historia de usuario:** Como organización en AWS, quiero controles remotos desacoplados del baseline local.

#### Criterios de aceptación

16.1. **CUANDO** se seleccione `--provider=aws-codecommit` o el pack equivalente, **EL INSTALADOR DEBERÁ** agregar artefactos AWS sin convertirlos en dependencia del core ni instalar GitHub.

16.2. **CUANDO** se configure CodeCommit, **EL PACK DEBERÁ** definir IAM de mínimo privilegio que restrinja pushes/acciones sobre la rama default y operaciones destructivas según roles autorizados.

16.3. **EL PACK Y SU DOCUMENTACIÓN DEBERÁN** declarar explícitamente: **IAM sobre la rama `main`/default protege esa rama, pero no evita que un secreto llegue a una feature branch**; por ello los escaneos local, pre-push y CI siguen siendo obligatorios.

16.4. **CUANDO** se configure revisión remota, **EL PACK DEBERÁ** soportar approval rule templates/rules con revisores mínimos, separación de funciones y prevención de autoaprobación cuando AWS lo permita.

16.5. **CUANDO** se genere integración CI/CD, **EL PACK DEBERÁ** contemplar CodeBuild/CodePipeline, gates de seguridad, artefactos redactados y una aprobación manual antes de producción.

16.6. **CUANDO** ocurran eventos relevantes, **EL PACK DEBERÁ** permitir notificaciones mediante SNS/EventBridge para fallos, bypasses, cambios de política y rotaciones, sin incluir secretos.

16.7. **CUANDO** se administren credenciales/IAM keys, **EL PACK DEBERÁ** preferir roles y credenciales temporales, definir rotación y revocación, y detectar credenciales estáticas obsoletas sin imprimirlas.

16.8. **CUANDO** se apliquen plantillas AWS, **EL SISTEMA DEBERÁ** ofrecer dry-run/plan, parámetros por entorno y rollback, sin aplicar cambios cloud automáticamente salvo confirmación explícita.

### Requisito 17 — Pack opcional GitHub

**Historia de usuario:** Como organización en GitHub, quiero complementar controles locales con enforcement remoto nativo.

#### Criterios de aceptación

17.1. **CUANDO** se seleccione `--provider=github` o el pack equivalente, **EL INSTALADOR DEBERÁ** agregar artefactos GitHub sin convertirlos en dependencia del core ni instalar AWS.

17.2. **CUANDO** la organización/repo soporte rulesets, **EL PACK DEBERÁ** preferir rulesets; **SI NO**, deberá configurar o documentar branch protection equivalente.

17.3. **CUANDO** se proteja la rama default, **EL PACK DEBERÁ** exigir PR, revisiones mínimas configurables, checks requeridos, resolución de conversaciones y restricción de force push/borrado.

17.4. **CUANDO** se generen GitHub Actions, **EL PACK DEBERÁ** fijar actions por SHA inmutable, declarar permisos mínimos, proteger eventos de forks y ejecutar los comandos core portables.

17.5. **CUANDO** GitHub secret scanning/push protection esté disponible por plan y permisos, **EL PACK DEBERÁ** detectarlo y habilitarlo o guiar su habilitación; **SI NO ESTÁ DISPONIBLE**, deberá reportarlo sin sustituir Gitleaks.

17.6. **CUANDO** se configure CODEOWNERS o revisores, **EL PACK DEBERÁ** proteger cambios a políticas, workflows, hooks, allowlists y configuración de seguridad con revisión de propietarios apropiados.

17.7. **SI** faltan permisos API para observar/aplicar protección, **EL PACK DEBERÁ** diferenciar `no autorizado` de `no configurado` y ofrecer comandos/diff, no afirmar éxito.

### Requisito 18 — Plantillas mínimas de PR y ticket

**Historia de usuario:** Como desarrollador, quiero trazabilidad útil sin burocracia excesiva.

#### Criterios de aceptación

18.1. **CUANDO** se instale una plantilla de PR, **EL SISTEMA DEBERÁ** limitarla a: referencia de ticket, resumen/riesgo, evidencia de pruebas/seguridad, impacto de secretos/datos y plan de rollback cuando aplique.

18.2. **CUANDO** se proporcione una plantilla de ticket, **EL SISTEMA DEBERÁ** limitarla a: objetivo, criterios de aceptación, riesgo/datos, dependencias y evidencia requerida.

18.3. **LAS PLANTILLAS NO DEBERÁN** solicitar secretos, dumps, tokens, credenciales, prompts completos ni logs sin redactar.

18.4. **CUANDO** un campo no aplique, **EL USUARIO DEBERÁ** poder marcar `N/A` con razón breve; el sistema no deberá exigir texto de relleno.

18.5. **CUANDO** una plantilla declare verificación, **DEBERÁ** aplicar los requisitos de evidencia del Requisito 11.

### Requisito 19 — Respuesta a incidentes y rotación

**Historia de usuario:** Como equipo, quiero un procedimiento accionable cuando se detecte o exponga un secreto.

#### Criterios de aceptación

19.1. **CUANDO** se detecte un posible secreto, **EL SISTEMA DEBERÁ** proporcionar un runbook que priorice contener, revocar/rotar, evaluar uso, eliminar del código, decidir tratamiento del historial, notificar y documentar cierre.

19.2. **EL RUNBOOK DEBERÁ** declarar que borrar el secreto del último commit no invalida una credencial ya expuesta y que la rotación/revocación es obligatoria según el proveedor.

19.3. **CUANDO** el secreto llegue a una feature branch remota, **EL PROCEDIMIENTO DEBERÁ** activarse aunque la rama default esté protegida por IAM/rulesets.

19.4. **CUANDO** se requiera reescribir historial, **EL RUNBOOK DEBERÁ** exigir coordinación, backup, identificación de clones/refs/tags afectados, invalidación previa del secreto y verificación posterior.

19.5. **CUANDO** cierre el incidente, **EL SISTEMA DEBERÁ** conservar evidencia redactada de rotación, alcance y controles preventivos, sin almacenar el secreto original.

19.6. **CUANDO** una credencial administrada tenga fecha de rotación, **LA AUDITORÍA DEBERÁ** advertir y luego fallar según umbrales configurables, siempre que la fuente remota permita verificarlo.

### Requisito 20 — Rollout warning a enforcement

**Historia de usuario:** Como organización con repos existentes, quiero adoptar controles sin bloquear todo el trabajo de forma abrupta.

#### Criterios de aceptación

20.1. **CUANDO** se instale sobre un repositorio existente, **EL DEFAULT DE MIGRACIÓN DEBERÁ** iniciar en `warning` salvo configuración organizacional explícita más estricta.

20.2. **CUANDO** se instale en un repositorio nuevo, **EL DEFAULT DEBERÁ** ser enforcement para secretos nuevos, bypasses `--no-verify` en adaptadores y pushes peligrosos, manteniendo configurables los controles que dependan de servicios externos.

20.3. **CUANDO** opere en warning, **EL SISTEMA DEBERÁ** ejecutar el mismo detector y alcance que enforcement, diferenciándose sólo en la decisión de bloqueo y registrando deuda/baseline.

20.4. **CUANDO** se promueva a enforcement, **EL CLI DEBERÁ** comprobar prerrequisitos, hallazgos existentes, disponibilidad de herramientas/servicios y estado de CI antes de activar gates.

20.5. **SI** existen hallazgos legacy, **EL SISTEMA DEBERÁ** permitir baseline temporal con propietario y expiración, pero bloquear hallazgos nuevos.

20.6. **CUANDO** se cambie el modo, **EL SISTEMA DEBERÁ** registrar actor/origen, fecha, configuración anterior/nueva y evidencia del readiness check.

20.7. **SI** un baseline o excepción expira, **EL SISTEMA DEBERÁ** advertir antes y aplicar enforcement al expirar según política.

### Requisito 21 — Actualización y migración seguras

**Historia de usuario:** Como propietario de una instalación personalizada, quiero recibir parches sin perder mis cambios.

#### Criterios de aceptación

21.1. **CUANDO** se instale o actualice, **EL SISTEMA DEBERÁ** mantener un manifiesto de artefactos administrados con versión, checksum original, estado de personalización, migraciones aplicadas y ownership.

21.2. **CUANDO** se ejecute `update`, **EL CLI DEBERÁ** comparar estado actual, versión objetivo y personalizaciones, y mostrar un dry-run/diff antes de cambios destructivos o conflictivos.

21.3. **SI** un archivo administrado no fue personalizado, **EL ACTUALIZADOR DEBERÁ** reemplazarlo de forma atómica por la versión nueva.

21.4. **SI** un archivo administrado fue personalizado, **EL ACTUALIZADOR DEBERÁ** realizar merge estructurado seguro para JSON/YAML/ignores cuando sea posible o generar un conflicto/diff sin sobrescribirlo.

21.5. **CUANDO** actualice Markdown/scripts no fusionables con seguridad, **EL ACTUALIZADOR DEBERÁ** preservar el archivo, instalar una propuesta lado a lado o requerir resolución explícita.

21.6. **CUANDO** aplique una migración, **EL SISTEMA DEBERÁ** crear backup, usar escrituras atómicas, registrar progreso y ofrecer rollback si falla a mitad.

21.7. **CUANDO** se repita una migración completada o parcialmente fallida, **EL RESULTADO DEBERÁ** ser reentrante e idempotente.

21.8. **CUANDO** migre desde `kiritek-init` 0.1.0 o una instalación parcial, **EL SISTEMA DEBERÁ** detectar artefactos existentes, conservar personalizaciones y corregir el workflow que hacía push directo.

21.9. **SI** una actualización contiene un parche crítico, **EL CLI DEBERÁ** identificarlo y priorizarlo, pero no deberá destruir personalizaciones; deberá bloquear la declaración de conformidad hasta resolver conflictos críticos.

21.10. **CUANDO** se agreguen/quiten stacks, Jira, asistentes o providers, **EL ACTUALIZADOR DEBERÁ** reconciliar documentación/configuración administrada sin dejar referencias obsoletas ni borrar contenido del usuario.

21.11. **CUANDO** el update necesite acceso de red, **EL CLI DEBERÁ** soportar modo offline/cache y nunca ejecutar contenido remoto mutable sin verificación.

### Requisito 22 — Flags y configuración del CLI

**Historia de usuario:** Como usuario local o de CI, quiero configuración explícita, validada y automatizable.

#### Criterios de aceptación

22.1. **CUANDO** se invoque el CLI, **EL PARSER DEBERÁ** soportar flags documentados tanto booleanos como con valor, `--help`, `--version`, errores por flags desconocidos y salida no interactiva determinista.

22.2. **EL CLI DEBERÁ** soportar como mínimo configuración para: `security`, `mode`, `gitleaks-version/source`, `default-branch`, `jira`, `jira-key-pattern`, `jira-fallback`, `provider`, `assistants`, `hooks`, `ci`, `report-dir`, `offline`, `dry-run`, `yes/non-interactive` y `format`.

22.3. **CUANDO** una opción se defina en múltiples fuentes, **EL SISTEMA DEBERÁ** aplicar una precedencia documentada entre CLI, variables de entorno, configuración de proyecto y defaults, mostrando el origen efectivo sin revelar secretos.

22.4. **CUANDO** la configuración sea inválida, **EL CLI DEBERÁ** fallar antes de modificar el proyecto y señalar la clave/valor inválido de forma segura.

22.5. **CUANDO** opere en CI/no interactivo, **EL CLI NO DEBERÁ** abrir prompts; deberá fallar si falta una decisión obligatoria.

22.6. **CUANDO** se use `--dry-run`, **EL CLI NO DEBERÁ** modificar archivos, Git config, hooks, red remota ni proveedores; deberá listar cambios y comandos propuestos.

22.7. **CUANDO** se use salida JSON, **EL CLI DEBERÁ** mantener stdout parseable y enviar diagnóstico humano a stderr.

22.8. **SI** se especifica un stack/provider/asistente desconocido, **EL CLI DEBERÁ** fallar; no deberá descartarlo silenciosamente.

### Requisito 23 — Compatibilidad de plataforma

**Historia de usuario:** Como desarrollador en distintos sistemas, quiero conocer y obtener una experiencia razonablemente portable.

#### Criterios de aceptación

23.1. **EL SISTEMA DEBERÁ** soportar macOS y Linux en arquitecturas mantenidas por las herramientas fijadas, y Windows mediante scripts Node/PowerShell o entorno Git compatible donde sea razonable.

23.2. **CUANDO** una función no pueda soportarse en Windows nativo, **EL CLI DEBERÁ** detectarlo, explicar la alternativa soportada y no ejecutar comandos POSIX incompatibles.

23.3. **CUANDO** instale o ejecute hooks, **EL SISTEMA DEBERÁ** funcionar con rutas con espacios, separadores de plataforma, line endings CRLF/LF y permisos ejecutables aplicables.

23.4. **CUANDO** ejecute preflight, **EL CLI DEBERÁ** validar Node, Git, shell/runtime requerido, conectividad/proxy si aplica, permisos y compatibilidad de arquitectura antes de modificar el repo.

23.5. **CUANDO** opere en monorepos o subdirectorios, **EL SISTEMA DEBERÁ** resolver la raíz Git y permitir alcance/configuración por workspace sin escanear fuera del repo.

23.6. **CUANDO** encuentre symlinks, **EL INSTALADOR/SCANNER DEBERÁ** impedir escapes fuera del repositorio y documentar si los sigue o no.

23.7. **CUANDO** no haya red o exista proxy corporativo, **EL CLI DEBERÁ** usar cache/fuentes configuradas, respetar certificados corporativos explícitos y ofrecer instalación manual verificada.

### Requisito 24 — Supply chain del instalador y controles

**Historia de usuario:** Como responsable de plataforma, quiero que instalar seguridad no introduzca dependencias no verificadas.

#### Criterios de aceptación

24.1. **CUANDO** el CLI descargue herramientas, actions, paquetes o templates, **EL SISTEMA DEBERÁ** fijar versiones/revisiones inmutables y verificar checksums, firmas o procedencia disponible.

24.2. **EL INSTALADOR NO DEBERÁ** ejecutar por defecto patrones equivalentes a `curl | sh` ni código desde branches/tags mutables.

24.3. **CUANDO** una instalación requiera un gestor externo, **EL CLI DEBERÁ** mostrar nombre exacto del paquete, proveedor, versión y fuente antes de instalarlo, y detectar nombres potencialmente inconsistentes o typosquatting.

24.4. **CUANDO** se publique `kiritek-init`, **EL PROYECTO DEBERÁ** definir canal oficial, versionado, integridad del paquete/tarball, changelog y procedencia reproducible.

24.5. **CUANDO** se actualicen dependencias fijadas, **EL PROCESO DEBERÁ** incluir revisión de release notes, checksum/procedencia, pruebas de compatibilidad y rollback.

24.6. **CUANDO** un workflow consuma terceros, **EL PACK DEBERÁ** aplicar mínimo privilegio y fijación inmutable también a dependencias transitivas controlables.

24.7. **CUANDO** se genere un inventario, **EL SISTEMA DEBERÁ** incluir opcionalmente SBOM del propio `kiritek-init` y sus herramientas distribuidas, sin afirmar cobertura de dependencias no inspeccionadas.

### Requisito 25 — Observabilidad y métricas seguras

**Historia de usuario:** Como mantenedor, quiero observar adopción y fallos sin recolectar secretos ni código.

#### Criterios de aceptación

25.1. **CUANDO** se registren ejecuciones, **EL SISTEMA DEBERÁ** emitir eventos estructurados con control, versión, modo, duración, alcance agregado, resultado y categoría de error.

25.2. **LOS EVENTOS NO DEBERÁN** incluir contenido de archivos, secretos, prompts, diffs, nombres de personas ni URLs con credenciales.

25.3. **CUANDO** se envíen métricas centralizadas, **EL SISTEMA DEBERÁ** usar opt-in, identificador pseudónimo configurable, autenticación, idempotency key y política de retención.

25.4. **CUANDO** se visualice cumplimiento, **EL SISTEMA DEBERÁ** distinguir instalación, cobertura, ejecución reciente, hallazgos y enforcement; no deberá resumirlos en un único booleano engañoso.

25.5. **CUANDO** un hook exceda un presupuesto de duración configurable, **EL SISTEMA DEBERÁ** registrar la degradación y orientar optimización, sin omitir controles silenciosamente.

25.6. **CUANDO** aumenten errores de herramienta, bypasses, excepciones o fallos de Jira/CI, **EL SISTEMA DEBERÁ** permitir alertas sin transmitir datos sensibles.

### Requisito 26 — Pruebas automatizadas y fixtures

**Historia de usuario:** Como mantenedor de `kiritek-init`, quiero demostrar que instalación y gates funcionan en escenarios reales y borde.

#### Criterios de aceptación

26.1. **EL PROYECTO DEBERÁ** incluir pruebas unitarias para parsing/configuración, rama default, rangos staged/pre-push, refspecs, Conventional Commits, claves Jira, redacción, allowlists, manifests, merges y auditoría por capas.

26.2. **EL PROYECTO DEBERÁ** incluir pruebas de integración con repos Git temporales para hooks existentes/nuevos, `core.hooksPath`, múltiples worktrees, ramas nuevas, pushes múltiples, default branches no estándar y rollback.

26.3. **EL PROYECTO DEBERÁ** incluir smoke tests de instalación limpia, repetida, update desde 0.1.0, instalación parcial, warning, enforcement, sin Jira, sin red y con cada provider opcional desacoplado.

26.4. **CUANDO** pruebe detección de secretos, **LOS FIXTURES DEBERÁN** usar valores sintéticos/no funcionales que activen reglas sin contener credenciales reales.

26.5. **CUANDO** pruebe ejemplos permitidos, **LAS PRUEBAS DEBERÁN** demostrar que placeholders pasan y que un secreto sintético dentro de `.env.example` o ruta allowlisted falla.

26.6. **LAS PRUEBAS DEBERÁN** verificar que reportes, logs, errores, artefactos y métricas no contienen el valor sintético detectado.

26.7. **LAS PRUEBAS DEBERÁN** ejecutarse al menos en macOS, Linux y Windows para el subconjunto declarado compatible, registrando skips con razón.

26.8. **LAS PRUEBAS DEBERÁN** cubrir indisponibilidad, timeout, rate limit y respuestas negativas de Jira, además de los dos fallbacks configurables.

26.9. **LAS PRUEBAS DEBERÁN** verificar que ningún workflow generado hace push directo y que las dependencias/actions quedan fijadas.

26.10. **CUANDO** un test declare éxito, **EL PIPELINE DEBERÁ** conservar evidencia de comando, versión y exit code conforme al Requisito 11.

### Requisito 27 — Documentación y migración operativa

**Historia de usuario:** Como equipo adoptante, quiero entender instalación, límites, operación y recuperación.

#### Criterios de aceptación

27.1. **EL PROYECTO DEBERÁ** documentar arquitectura conceptual core/adaptadores/packs, matriz de controles por etapa, defaults, flags, precedencia y estados de auditoría.

27.2. **EL PROYECTO DEBERÁ** incluir guías separadas para instalación nueva, adopción en repo existente, update desde 0.1.0, rollback, desinstalación y resolución de conflictos.

27.3. **EL PROYECTO DEBERÁ** documentar setup y límites de Claude Code, Kiro, Jira, GitHub y AWS CodeCommit, incluida la imposibilidad de los hooks cliente de impedir todos los bypasses.

27.4. **LA DOCUMENTACIÓN AWS DEBERÁ** repetir explícitamente que IAM sobre la rama default no impide que un secreto llegue a una feature branch.

27.5. **EL PROYECTO DEBERÁ** incluir runbooks para falso positivo, herramienta no disponible, Jira caído, secreto detectado, secreto publicado, rotación, reescritura de historial y break-glass.

27.6. **CUANDO** una capacidad dependa de plan/licencia/permisos de proveedor, **LA DOCUMENTACIÓN DEBERÁ** marcarla como condicional y explicar el fallback.

27.7. **CUANDO** cambie una política o versión fijada, **EL CHANGELOG DEBERÁ** indicar impacto, migración, compatibilidad y si el cambio altera enforcement.

27.8. **LA DOCUMENTACIÓN NO DEBERÁ** recomendar detectores de autoría IA como control de seguridad ni gate.

### Requisito 28 — Seguridad y gobernanza de excepciones

**Historia de usuario:** Como responsable de seguridad, quiero excepciones controladas que no se conviertan en bypasses permanentes.

#### Criterios de aceptación

28.1. **CUANDO** se cree una excepción, **EL SISTEMA DEBERÁ** exigir control afectado, fingerprint/ruta mínima, razón, propietario, ticket, fecha de creación y expiración.

28.2. **CUANDO** una excepción afecte políticas, workflows, hooks o secretos, **EL SISTEMA DEBERÁ** requerir revisión por un owner distinto del autor cuando el proveedor lo permita.

28.3. **SI** una excepción no tiene expiración o es excesivamente amplia, **EL VALIDADOR DEBERÁ** rechazarla en enforcement.

28.4. **CUANDO** una excepción expire o el hallazgo cambie de fingerprint, **EL SISTEMA DEBERÁ** reevaluar y bloquear como hallazgo nuevo.

28.5. **CUANDO** se auditen excepciones, **EL REPORTE DEBERÁ** mostrar cantidad, edad, propietario y estado sin incluir el contenido sensible.

28.6. **EL SISTEMA NO DEBERÁ** tratar `--no-verify`, desactivar el workflow o editar directamente el reporte como mecanismo válido de excepción.

## 6. Requisitos no funcionales

### 6.1 Rendimiento

- El pre-commit deberá priorizar sólo staged content y tener un presupuesto configurable, con objetivo de completar en menos de 5 segundos para cambios habituales una vez disponible la herramienta.
- El pre-push podrá usar caché por commit/configuración, sin reutilizar resultados obsoletos.
- Los escaneos profundos de historial deberán poder ejecutarse en CI/schedule sin degradar hooks interactivos.

### 6.2 Confiabilidad

- Las modificaciones de instalación/migración deberán ser atómicas o recuperables.
- Un error de herramienta deberá distinguirse de un resultado limpio.
- El mismo commit, versión y configuración deberán producir decisiones equivalentes localmente y en CI para el mismo alcance.

### 6.3 Seguridad

- Ningún secreto detectado deberá aparecer en stdout, stderr, reportes, métricas, artefactos, comentarios o evidencia.
- Los procesos externos deberán recibir sólo las credenciales mínimas y nunca credenciales de contextos confiables al analizar código no confiable.
- Las configuraciones de política y sus cambios deberán ser revisables y protegibles por owners remotos.

### 6.4 Usabilidad

- Cada bloqueo deberá incluir causa, alcance, remediación y vía válida de excepción.
- La salida deberá diferenciar error de configuración, indisponibilidad, hallazgo y violación de política.
- Los comandos deberán tener ayuda accionable y salida JSON estable para automatización.

## 7. Criterios globales de aceptación de la iniciativa

G.1. Una instalación limpia sin stacks instala el core de seguridad, una versión exacta/verificada de Gitleaks, configuración portable, hooks componibles y auditoría por capas.

G.2. Repetir `init` y `update` no duplica hooks ni entradas y no altera personalizaciones sin resolución explícita.

G.3. Un secreto sintético staged es bloqueado por pre-commit; uno presente en un commit nuevo del rango enviado es bloqueado por pre-push; uno histórico es detectado por el job CI configurado.

G.4. `.env.example` con placeholders pasa, pero el mismo archivo con un secreto sintético falla.

G.5. Push directo a una rama default detectada dinámicamente, push forzado peligroso y `--no-verify` desde adaptadores soportados son bloqueados en enforcement.

G.6. Conventional Commits se valida localmente; Jira configurable valida sintaxis local y existencia remota en pre-push/CI con fallback y estado no verificado claramente definidos.

G.7. El control genérico de secretos no reside en Flutter; el pack Flutter mantiene controles OWASP móviles especializados y todos sus resultados redactan secretos.

G.8. El workflow de auditoría no hace push directo y los workflows generados usan permisos mínimos, dependencias inmutables y los comandos core portables.

G.9. Los packs AWS y GitHub se pueden instalar y probar por separado; ninguno es requisito del core ni del otro provider.

G.10. La documentación y controles AWS demuestran y declaran que IAM sobre la rama default no impide exposición en una feature branch.

G.11. La auditoría detecta archivo ausente, versión incorrecta, checksum/config drift, hook desconectado, scanner no ejecutable, ejecución vencida y enforcement desactivado como estados distintos.

G.12. Ningún valor secreto sintético aparece en resultados o telemetría durante la suite completa.

G.13. Una migración desde 0.1.0 preserva hooks y configuraciones personalizadas, instala el baseline en warning, corrige el workflow inseguro mediante diff/merge y permite promover a enforcement tras readiness check.

G.14. La matriz CI ejecuta pruebas unitarias, integración y smoke en las plataformas declaradas, con evidencia asociada a cada estado verificado.

G.15. No existe detector de autoría IA en la ruta de bloqueo de commit, push, PR, merge o release.

## 8. Trazabilidad de riesgos principales

| Riesgo | Requisitos mitigantes |
| --- | --- |
| Secreto nuevo en commit/push/PR | 2, 3, 4, 5, 6, 13, 15 |
| Secreto en feature branch pese a protección de default | 3, 16, 17, 19 |
| Bypass o push destructivo | 7, 8, 15, 16, 17, 28 |
| Ticket inexistente o trazabilidad falsa | 9, 10, 11, 18 |
| Falsa sensación de cumplimiento | 11, 14, 25 |
| Reporte que filtra el secreto | 12, 13, 25, 26 |
| Update destruye personalizaciones o deja controles obsoletos | 4, 20, 21 |
| Dependencia comprometida/mutable | 2, 15, 24 |
| Incompatibilidad de plataforma | 2, 4, 22, 23, 26 |
| Caída Jira bloquea o habilita cambios de forma impredecible | 10, 26, 27 |
| Excepciones permanentes | 3, 20, 28 |

## 9. Dependencias y supuestos

- Git está disponible para activar hooks; sin Git, la instalación queda parcial y explícitamente no conforme.
- La validación remota Jira requiere endpoint/tenant y credenciales de sólo lectura adecuadas.
- Las protecciones remotas dependen de capacidades, plan y permisos del proveedor; el core local no debe depender de ellas.
- Gitleaks sigue siendo una herramienta externa y su actualización de versión fijada debe atravesar el proceso de supply chain y pruebas.
- Los hooks de asistentes complementan, pero no sustituyen, hooks Git y gates remotos.
- La rama default puede cambiar y debe revalidarse; no se considera un valor constante universal.

## 10. Evidencia requerida para cerrar la fase de implementación futura

La implementación sólo podrá declararse completa cuando existan:

1. Resultados de las suites unitarias, integración y smoke con comandos y exit codes.
2. Matriz de plataformas y escenarios ejecutados.
3. Demostración de instalación limpia, idempotencia y migración desde 0.1.0 con personalizaciones.
4. Fixtures positivos/negativos de secretos, placeholders, Git, Jira y rama default.
5. Reportes redactados que demuestren ausencia del secreto sintético.
6. Workflows inspeccionados que no hagan push directo y tengan permisos/pins adecuados.
7. Auditoría por capas de al menos un estado sano y estados degradados representativos.
8. Validación independiente de packs AWS y GitHub instalados por separado.
9. Runbooks revisados para detección, publicación, rotación y break-glass.
10. Changelog, guía de migración y documentación de límites actualizados.
