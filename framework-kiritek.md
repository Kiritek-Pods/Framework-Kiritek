# Resumen: Sesiones de Uso de IA → Framework Kiritek

**Sesiones cubiertas:**

- Charla IA – Alejandra (3 jul 2026)
- Charla IA – César (6 jul 2026)
- Sesión grupal – Framework Kiritek (8 jul 2026)

**Líderes del framework:** Vladimir, Oscar y Miguel
**Fecha de entrega de la propuesta:** Lunes 13 de julio, 4:00 pm

---

## 1. Contexto y objetivo

La intención inicial de estas charlas era conocer cómo el equipo de desarrollo está usando la IA en sus proyectos, para identificar ideas y automatizar aún más. El disparador fue la percepción de que cada quien trabaja como quiere, avanzamos lento y no estamos aprovechando la IA al 100%.

Después de la primera sesión (Alejandra) y la segunda (César), el objetivo se amplió: en vez de solo recoger ideas sueltas, se decidió crear un Framework Kiritek único que:

- Todos los desarrolladores deben seguir (skills, agentes, plugins, configuración mínima).
- Eventualmente también deben usar los líderes de proyecto, utilizando un repositorio desde el cual se generen las historias.
- Busca que la IA potencie al desarrollador (no lo sustituya) y elimine la percepción de lentitud.
- Se validará con KPIs que el equipo defina más adelante.

---

## 2. Ideas por sesión

### 2.1 Sesión con Alejandra (proyecto MYSCIE)

**Contexto del proyecto:** MYSCIE es un proyecto legacy (primer commit 2017, código real desde ~2010), con múltiples frameworks conviviendo (Sencha 3.2 y 6.1 en front, Java Vanilla/Servlets + Spring Boot en back), mucho código "muerto" y reglas de negocio no escritas. Por eso su primera regla de uso de IA fue que nunca entre a las carpetas del framework/librerías de terceros.

**Flujo actual:** antes usaba Claude en la web para documentación y generación de diagramas/manuales; ahora con Claude Code trabaja con Plan Mode para desarrollos nuevos, y en el MYSCIE (legacy) prefiere que le pregunte antes de editar — nunca lo deja trabajar "full" solo en código legacy, sí en desarrollos nuevos.

Cada vez que toca una Lambda nueva, genera primero un CLAUDE.md/README con la estructura del proyecto.

**Ideas clave que surgieron:**

- Integrar MCP de Jira: traer historias directamente, y que el propio Claude escriba comentarios/endpoints en el ticket al cerrar.
- Indexar el código (mencionan los repos GraphCode y Graphify): genera un grafo (clases, endpoints, entidades, relaciones) en vez de leer archivo por archivo → ahorra muchísimos tokens.
- Usar AGENTS.md en vez de solo CLAUDE.md: Claude solo lee CLAUDE.md, pero OpenCode, Codex, Gemini, etc. leen AGENTS.md — poner ahí todo permite trabajar con cualquier herramienta sin duplicar configuración.
- Buenas prácticas de ahorro de tokens: limpiar el contexto al cambiar de proyecto, no instalar agentes de forma global (solo por proyecto), usar Plan Mode.
- Idea de "harness": dejar que la IA trabaje en loop (buscar → intentar → fallar → corregir → repetir) hasta terminar la historia sola, similar a cómo lo demuestra el equipo creador de Claude Code en conferencias.
- Playwright (probado con Pedro en el proyecto Skolable): antes de generar código, la IA usa Playwright para tomar capturas de pantalla del estado actual, proponer dónde colocar un botón o hacer un ajuste visual (sin tirar código todavía), y solo hasta que se revisan y aprueban las capturas genera el código; después vuelve a tomar capturas para validar que quedó bien (ajustes de margen, responsive/móvil, etc.) de forma iterativa. Se identifica como una herramienta clave para trabajo de front y se sugiere que debe estar en el stack mínimo.
- Estandarizar entre Alejandra y César: mismos skills, misma configuración — para que no importe quién tome el proyecto.
- Acciones concretas que se tomaron: automatizar más lo del MCP Jira, explorar indexado de código, unificar con lo que traiga César.

### 2.2 Sesión con César (Kiritek / base de conocimiento)

**Repo "fuente de conocimiento":** César ya usa un repositorio (Kiritek/Kirinova) con estructura por proyecto (context: AWS Infra/Terraform, inventario, chatbots, GTM) y una carpeta repositorio que el repo de conocimiento ignora pero que la IA sí puede leer en conversación (para saber "a dónde ir" cuando se habla de código).

**Flujo de trabajo actual:** recibe el ticket de Jira → conversa con Claude qué entendió la historia vs. lo que él entendió → encamina a Claude a las rutas correctas antes de que genere código (para no editar la ventana equivocada en proyectos con archivos duplicados/legacy) → primero busca documentación existente en el repo, si no existe la genera.

Ya usa agentes (dev-front, dev-back) con un orquestador ("master") y un tope de 2–3 reintentos de autocorrección (no loop infinito). Aún no está seguro qué tan confiable es el proceso de testing automático.

Creó una skill para pull requests: detecta rama, hace merge/pull, automatiza lo repetitivo.

**Ideas clave que surgieron:**

- Plan antes de ejecutar: unir el enfoque de ambos (Alejandra/César) — que al recibir la historia, la IA genere primero un plan detallado y solo tras aprobarlo se ejecute (ya lo hace por defecto cuando hay agentes configurados).
- Versionado de base de datos con migraciones independientes del framework de backend (menciona la herramienta Goose) — para dar más contexto a la IA sobre la estructura de datos y poder auditar queries.
- Sistema de memoria persistente (menciona un plugin tipo "Claude Mem"): guarda automáticamente contexto relevante en mini-SQL y permite retomar "lo que hicimos ayer/antier" sin repetir todo.
- Indexado/grafo de código: mismo tema que Alejandra, se valida que ahorra tokens, especialmente en repos grandes (MYSCIE, Skolable API).
- Rutina/schedule de tickets: que un agente revise Jira automáticamente y empiece a trabajar los tickets simples solo, avisando por correo antes de asignar a alguien (ej. Joana).

**Diferenciación conceptual importante (hubo debate en la sesión):**

- Skill = archivo .md con instrucciones/checklist para una tarea puntual (se invoca bajo demanda).
- Agente = sesión aparte con su propia ventana de contexto (hasta ~1M tokens independiente de la sesión principal); se le delega trabajo y no consume el contexto del chat principal.
- MCP = la capa que conecta/orquesta la base de conocimiento con las herramientas de cada developer ("broadcast").
- Harness = el conjunto completo (skills + agentes + MCPs + reglas) que le da "riendas" a la IA para que no se descontrole.

**Propuesta de 3 frentes de trabajo:**

1. Contexto / base de conocimiento compartida entre todos los proyectos.
2. Lineamientos técnicos comunes (Conventional Commits, GitFlow, estructura de carpetas front/back) como un repo de skills.
3. Skills dedicadas por stack/proyecto + un MCP custom "Kiritek" que orqueste el conocimiento con lo que cada developer usa (Claude, Gemini, lo que sea).

Antes de invertir en todo esto, César sugiere definir qué es un "proyecto de calidad" para Kiritek (más allá del código bonito): objetivos concretos por proyecto (ej. reducir costo de infraestructura, mejorar performance de queries).

Hoy Heriberto y Joana trabajan aislados, cada quien con su propio Claude/contexto, ajenos al repo — se necesita sumarlos.

Joana está probando Obsidian como backlog/Kanban (alternativa a pagar más licencias de Jira) — se ve como un paso independiente del lado de PM/negocio, no bloqueante para el framework técnico.

### 2.3 Sesión grupal (Framework Kiritek, con Vladimir/Oscar/Miguel/Pedro/Arce/Nico y otros)

Se repasó lo visto en las dos sesiones anteriores y se contrastaron las formas de trabajo del equipo — cada quien tiene su método (algunos solo CLAUDE.md + memoria, otros agentes especializados por función, otros un orquestador tipo SDD con sub-agentes).

**Herramientas y prácticas adicionales que salieron en esta sesión:**

- CodeGraph / indexado de código: confirmado como pieza central del stack propuesto.
- Memoria persistente: confirmado como segunda pieza central.
- Harness tipo Superpowers por encima de Claude: no deja "hazlo y ya", sino que fuerza definir alcance antes de codear.
- Workspaces preconfigurados (estilo perfiles) para que developers no técnicos tengan acceso rápido a carpetas de front/back/chatbot por proyecto.
- Análisis de interdependencia de historias: cuando llegan varias historias relacionadas (ej. 3 endpoints de una misma API), el equipo no coincide si conviene tirarlas todas juntas o analizarlas una por una — se identificó como algo que la IA podría ayudar a resolver automáticamente si tiene el contexto completo del backlog.
- Git Worktree: trabajar hasta 5 historias en paralelo en subcarpetas del mismo proyecto (con un comando personalizado), en vez de esperar a terminar una historia para empezar otra — ahorra tiempo y tokens, especialmente combinado con Plan Mode.
- Base de datos vectorial sincronizada con el repo remoto: para evitar que la IA use como referencia una copia local desactualizada del código (problema ya detectado).
- Migración de AWS CodeCommit → GitHub: CodeCommit ya no tiene soporte de AWS; migrar el source del pipeline a GitHub (el build seguiría en AWS) permitiría conectar Claude directo a Issues/PRs de GitHub, incluso para que PMs asignen tareas simples (ej. cambio de color) sin pasar por el repositorio técnico. Se pidió a Alan un análisis de impacto/tiempo de migración.
- Rutinas programadas (Claude Code Routines): pueden correr en la nube sin que la máquina esté prendida. Ejemplo real ya en producción: KIRA (bot de inteligencia comercial) corre todos los lunes 7:30–8am, revisa HubSpot, Kiripay y correo, detecta alertas (ej. detectó una caída de Skolable leyendo una alerta por correo), genera tareas para asesores y sube el contexto en archivos .md al repo.
- Necesidad de una capa mínima de revisión/testing antes de que el código generado por IA suba directo a producción — el PR sigue requiriendo revisión humana; se evalúa un flujo ligero para cambios triviales que incluso un PO pudiera disparar.

**Puntos abiertos que quedaron para que Vladimir/Oscar/Miguel decidan:**

- ¿Un solo repositorio para todo Kiritek, uno por POD (como ya existe en Kirinova/Taneforus), o mantener el esquema mixto actual?
- ¿La "base de conocimiento" y el "framework técnico" (skills/agentes) viven juntos o separados?
- Nivel exacto de automatización en la asignación de tickets (¿la IA puede empezar sola con tickets simples o siempre debe mediar una persona?).

---

## 3. Objetivo del Framework Kiritek

Unificar la forma en que todo el equipo de desarrollo usa la IA (mismos skills, agentes, plugins y configuración mínima), para avanzar más rápido, dejar de trabajar aislado, y —en una segunda etapa— integrar a los líderes de proyecto para que las historias se generen directamente desde los repositorios de trabajo. La IA no sustituye al desarrollador: lo potencia.

---

## 4. Flujo de trabajo propuesto

### Etapa 1 — Nivel técnico (developers) — primera prioridad, fecha fija

1. Vladimir, Oscar y Miguel definen el stack mínimo obligatorio de Kiritek: agentes, skills, plugins y herramientas (CodeGraph/indexado, memoria persistente, harness tipo Superpowers, MCP Jira, convenciones de commits/GitFlow/estructura de carpetas).
2. Se empaqueta como un repositorio de skills/framework descargable: cualquier developer nuevo (o que cambie de proyecto) lo instala y queda configurado con el mínimo necesario.
3. Todos trabajan bajo el mismo esquema (Plan Mode antes de ejecutar, agentes dev-front/dev-back/QA, orquestador, indexado de código).

### Etapa 2 — Integración de líderes de proyecto

1. Los líderes dejan de asignar historias de forma aislada en Jira; las crean directamente en los repositorios de trabajo, para que la IA tenga contexto desde el origen.
2. Se define la estructura de repos (única vs. por POD).
3. Se evalúa conectar a PMs/líderes directo a GitHub/Claude para tareas triviales.
4. Se evalúan herramientas de gestión visual del backlog (ej. Obsidian) en paralelo, sin bloquear la etapa técnica.

---

## 5. Agentes auditores (requisito explícito)

Durante el cierre de la sesión grupal, se planteó directamente la necesidad de que el framework incluya un agente (o mecanismo) que audite el cumplimiento: que alerte si alguien agregó un plugin no autorizado, o si no está usando las herramientas mínimas obligatorias — para no depender de estar preguntando manualmente "enséñame que sí estás usando esto".

Esto debe quedar como requisito explícito en la propuesta que armen Vladimir, Oscar y Miguel, no como algo opcional.

---

## 6. Mi sugerencia

Para que el agente auditor sea viable desde el día uno (y no otro proyecto que se quede a medias), sugiero:

- Empezarlo como una rutina programada simple, del mismo estilo que ya funciona con KIRA: un agente que corra periódicamente (ej. semanal) sobre cada repositorio de proyecto y verifique cosas objetivas y fáciles de chequear primero — presencia de CLAUDE.md/AGENTS.md, las skills obligatorias instaladas, convención de commits respetada — antes de intentar auditar cosas más subjetivas (calidad del código, uso "correcto" de agentes).
- Que el resultado se publique en el mismo repo de conocimiento (un .md de "estado de cumplimiento" por proyecto), en vez de solo notificar por correo, para que Vladimir/Oscar/Miguel tengan visibilidad histórica y no solo una alerta puntual.
- Definir el cumplimiento como parte de las métricas de la Etapa 1 desde la propuesta inicial (no como un añadido posterior), ya que fue precisamente la falta de auditoría lo que generó la fragmentación actual ("cada quien con sal, chile y pozol en su proyecto").
- Dejar explícitamente resuelto en la propuesta el punto abierto de un repo vs. repo por POD, porque el diseño del agente auditor depende de esa decisión (no es lo mismo auditar un repo que N repos).

---

## 7. Próximos pasos

| Acción                                                                                            | Responsable             | Fecha                      |
| ------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------- |
| Recibir las conversaciones/resúmenes procesados de las 3 sesiones                                 | Vladimir, Oscar, Miguel | Ya enviado                 |
| Generar propuesta de Framework Kiritek (Etapa 1 obligatoria; Etapa 2 opcional incluir de una vez) | Vladimir, Oscar, Miguel | —                          |
| Definir estructura de repos (único / por POD)                                                     | Vladimir, Oscar, Miguel | Como parte de la propuesta |
| Incluir mecanismo de agente auditor en la propuesta                                               | Vladimir, Oscar, Miguel | Como parte de la propuesta |
| Presentación de la propuesta a todo el equipo                                                     | Vladimir, Oscar, Miguel | Lunes 13 de julio, 4:00 pm |
| Análisis de impacto/tiempo de migración CodeCommit → GitHub                                       | Alan                    | Pendiente de agendar       |
