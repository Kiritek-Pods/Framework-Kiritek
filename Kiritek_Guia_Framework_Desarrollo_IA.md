# KIRITEK
## Guía de Framework de Desarrollo con IA

**Versión 1.0 — 20 de julio de 2026**
*Elaborado a partir de un panel de CIOs globales, adaptado a la realidad de Kiritek*

---

## 1. Propósito y alcance

Esta guía establece el criterio unificado de Kiritek para el uso de inteligencia artificial en el desarrollo de software. Nace de un intercambio entre CIOs de empresas globales sobre las herramientas y modelos de gobierno que están usando hoy sus equipos, y se adapta a la situación específica de Kiritek: un framework parcialmente definido, un equipo de desarrollo mixto (junior-senior), datos internos sensibles pero no regulados, y una prioridad clara en velocidad de time-to-market sin sacrificar seguridad ni costo.

El objetivo no es imponer una sola herramienta, sino fijar principios, un stack aprobado por etapa del ciclo de desarrollo, y un modelo de gobierno que escale con el equipo actual.

---

## 2. Qué dijeron los CIOs (síntesis)

Del panel se repiten cinco ideas, independientemente de la industria o el tamaño de la empresa:

- **Ninguna empresa usa una sola IA.** La norma es combinar herramientas por etapa: una para arranque, otra para desarrollo, otra para consolidación previa a pipeline.
- **El acceso no es universal.** Varios limitan el uso más profundo (prompting avanzado, agentes autónomos) a developers senior o full-stack, para no "quemar tokens" ni introducir riesgo innecesario.
- **El costo de tokens ya es un problema real.** Más de una empresa está evaluando o construyendo infraestructura propia (modelos locales tipo Ollama, granjas propias) para tareas repetitivas o de datos internos.
- **El código generado por IA trae vulnerabilidades con alta frecuencia (~40% según uno de los CIOs).** Ninguna empresa seria salta el gate de seguridad antes de pipeline.
- **El gobierno bien hecho paga:** el caso con mejor resultado reportado (agente de estándares + validación de arquitecto + ambientes controlados en la nube propia) logró más de 60% de reducción en time-to-market, a cambio de más tiempo invertido en validación y DevSecOps.

---

## 3. Principios rectores para Kiritek

Dado que Kiritek prioriza velocidad de time-to-market en balance con costo y seguridad, y tiene un equipo mixto trabajando sobre datos internos sensibles (no regulados), estos son los principios que deben guiar cualquier decisión de herramienta o proceso:

- **Velocidad con barandales, no velocidad sin control.** Se optimiza el tiempo de desarrollo, pero nada llega a pipeline sin pasar por el gate de arquitectura y seguridad.
- **Acceso escalonado por seniority.** Los devs senior tienen más libertad de herramienta y autonomía de prompting; los junior trabajan dentro de plantillas y flujos guiados por el agente de estándares.
- **Un stack aprobado, no una lista abierta.** Se define qué herramienta se usa en cada etapa del ciclo, evitando que cada dev elija libremente y se fragmente el conocimiento y el gasto.
- **Datos internos primero en local cuando aplique.** Al no ser datos regulados no se exige on-premise total, pero las cargas de analítica y cruces de información sensibles se priorizan en modelos locales para reducir exposición y costo.
- **Formalizar sobre lo que ya funciona.** Kiritek ya tiene prácticas informales; esta guía las documenta y les da estructura, no las reemplaza desde cero.

---

## 4. Stack de herramientas recomendado

El stack se organiza por etapa del ciclo de desarrollo, no por preferencia individual. Esto permite mezclar herramientas —como hacen todos los CIOs del panel— sin perder trazabilidad ni control de costo.

| Etapa del ciclo | Herramienta(s) sugeridas | Uso principal | Quién la usa |
|---|---|---|---|
| Ideación / arranque rápido (MVP, prototipos) | Gemini Pro o similar para arranque + Lovable para MVP desechables | Explorar alcance, generar primer esqueleto funcional antes de comprometer arquitectura | Product / Dev leads |
| Desarrollo full-stack e integraciones | Claude Code y Codex como estándar; Cursor como IDE multi-LLM para tareas de complejidad variable | Desarrollo del core, integraciones entre sistemas, features de negocio | Devs senior y semi-senior (mixto, con checklist obligatorio) |
| Consolidación pre-pipeline | Antigravity (o equivalente de consolidación/orquestación) | Unificar, limpiar y preparar el código antes de entrar a CI/CD | Dev senior a cargo del feature + arquitecto |
| Analítica, datos y BI | Ollama (modelos locales) para tareas de estadística y cruces de información | Evitar exponer datos internos sensibles a servicios cloud cuando no es necesario | Analistas / devs de datos |
| Seguridad y DevSecOps | Escaneo asistido por IA especializado en seguridad, integrado al gate de pipeline | Detectar vulnerabilidades típicas de código generado por IA (~40% de riesgo reportado por la industria) | DevSecOps / Seguridad |
| Pruebas y QA | Herramienta de testing asistido por IA sobre el stack aprobado | Generación y ejecución de casos de prueba antes de merge | QA / Devs |

> **Nota:** los nombres de herramienta son referenciales al panel de CIOs; el equipo de arquitectura de Kiritek debe validar la opción específica vigente en el momento de implementar (disponibilidad, licenciamiento, seguridad) antes de aprobarla formalmente.

---

## 5. Modelo de gobierno

Se adopta, adaptado al tamaño y madurez de Kiritek, el modelo que reportó mejores resultados en el panel: un agente de estándares que orienta al developer, y un arquitecto que valida antes de pipeline.

### 5.1 Agente de estándares

Todo developer (propio o tercero) tiene acceso a un agente interno que conoce el stack aprobado y los estándares de Kiritek. Este agente:

- Indica qué herramienta corresponde según la etapa y el tipo de tarea.
- Propone un plan de desarrollo y una arquitectura inicial en base al estándar vigente.
- Deja la decisión final de arquitectura al arquitecto humano, que valida y ajusta — no reemplaza el criterio del arquitecto, lo acelera.

### 5.2 Gate obligatorio antes de pipeline

Nada entra al pipeline de CI/CD sin revisión previa de cuatro frentes, replicando el criterio del CIO con mejor resultado de TTM:

- **Arquitectura** — el diseño respeta el estándar y no genera deuda técnica innecesaria.
- **Seguridad** — escaneo de vulnerabilidades específico para código generado por IA.
- **Infraestructura** — el consumo de recursos y el despliegue son viables en el ambiente de Kiritek.
- **Conectividad** — las integraciones con otros sistemas no rompen contratos existentes.

### 5.3 Acceso diferenciado por nivel

- **Senior / full-stack:** mayor autonomía de prompting, uso de agentes más complejos, pueden trabajar con IDEs multi-LLM para elegir el modelo según la dificultad de la tarea.
- **Junior:** trabajan dentro de flujos guiados por el agente de estándares, con revisión más cercana del senior o del arquitecto antes de escalar a producción.
- **Terceros:** mismas reglas que developers propios, pero con ambientes de desarrollo asignados y controlados por Kiritek (no en sus propias máquinas), para mantener todo el código y los repos en casa.

---

## 6. Ambientes de desarrollo

Siguiendo el caso de mejor resultado del panel, se recomienda que los developers —propios y terceros— trabajen en ambientes (workspaces) asignados dentro de la nube de Kiritek, en lugar de en máquinas locales de alto costo. Esto:

- Reduce la inversión en hardware para el equipo.
- Mantiene el código y los repositorios dentro del control de Kiritek en todo momento.
- Facilita aplicar el gate de seguridad y arquitectura de forma consistente, sin depender de la configuración de cada máquina individual.

Para cargas específicas de analítica o cruces de datos internos sensibles, se evalúa el uso de modelos locales (tipo Ollama) como complemento, priorizando reducción de exposición de datos y de costo de tokens sobre la conveniencia de un solo proveedor cloud.

---

## 7. Seguridad y DevSecOps

El punto de consenso más fuerte del panel: el código generado por IA introduce vulnerabilidades con una frecuencia significativa. Kiritek debe asumir esto como regla, no como excepción.

- Todo código generado o asistido por IA pasa por escaneo de seguridad automatizado antes de merge, sin excepción por urgencia de negocio.
- El tiempo de validación y DevSecOps va a subir respecto al esquema actual — esto es esperado y aceptable, es el costo de bajar drásticamente el tiempo de desarrollo.
- Se documentan y comunican al equipo los patrones de vulnerabilidad más comunes encontrados, para retroalimentar el agente de estándares y reducir su recurrencia.

---

## 8. Roadmap de adopción

Se propone una adopción por fases para no forzar de golpe un cambio de proceso sobre un framework que hoy es informal:

| Fase | Duración sugerida | Actividades clave |
|---|---|---|
| **Fase 0 — Formalización** | 2-3 semanas | Documentar el framework informal actual, aprobar stack de herramientas, definir el agente de estándares y el checklist de arquitectura. |
| **Fase 1 — Piloto controlado** | 4-6 semanas | 1-2 equipos piloto (mixto junior-senior). Ambientes de desarrollo en la nube de Kiritek. Gate de seguridad obligatorio activo desde el día uno. |
| **Fase 2 — Escalamiento** | 2-3 meses | Extender a todos los equipos propios y terceros. Medir TTM, tasa de vulnerabilidades detectadas y adopción real. |
| **Fase 3 — Optimización de costos** | Continuo | Evaluar modelos locales (Ollama) para cargas de analítica/datos internos si el gasto en tokens lo justifica. Revisar el stack cada trimestre. |

---

## 9. Métricas de éxito

- **Time-to-market (TTM):** tiempo de idea a producción por feature/proyecto. Meta de referencia del panel: reducción sostenida de hasta 60%.
- **Tasa de vulnerabilidades detectadas** en el gate de seguridad antes vs. después de la adopción formal del stack.
- **% de adopción real** del stack aprobado por parte del equipo (propio y terceros), no solo de "usuarios entusiastas".
- **Costo en tokens/licencias** por developer activo, y su tendencia trimestral.
- **Tiempo de validación** (arquitectura + seguridad + infra + conectividad) como proporción del ciclo total — se espera que suba, se mide para que no se dispare sin control.

---

## 10. Próximos pasos

- Validar con el equipo de arquitectura y seguridad de Kiritek qué herramientas específicas del stack propuesto se aprueban formalmente (disponibilidad, licencia, integración).
- Definir y desplegar el agente de estándares para developers propios y terceros.
- Elegir 1-2 equipos piloto mixtos (junior-senior) para la Fase 1 del roadmap.
- Fijar la cadencia de revisión del stack (sugerido: trimestral), dado lo rápido que evoluciona el mercado de estas herramientas.
