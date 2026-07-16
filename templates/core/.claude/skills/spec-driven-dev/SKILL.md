---
name: spec-driven-dev
description: >
  Use at the start of any ticket/historia — before writing code. Generates a spec
  (what/why) and a plan (how) from the ticket description, gets explicit approval,
  then breaks work into tasks. Mandatory for Kiritek: no implementation starts
  without an approved spec+plan, except trivial one-line fixes.
metadata:
  origin: adapted from github/spec-kit (MIT)
---

# Spec-Driven Development (SDD)

Kiritek obligatorio: al recibir una historia, la IA genera primero spec + plan y
espera aprobación antes de tocar código. Metodología simplificada, adaptada de
[github/spec-kit](https://github.com/github/spec-kit) — sin su tooling de CLI,
solo el flujo de documentos.

## Workflow

```
1. SPEC   — qué se construye y por qué (sin detalles técnicos)
2. PLAN   — cómo se construye (stack, estructura, decisiones técnicas)
3. TASKS  — lista ordenada, ejecutable, de pasos concretos
4. APROBACIÓN — el developer revisa spec+plan+tasks antes de que se escriba código
5. IMPLEMENT — ejecución tarea por tarea, con checkpoints de verificación
```

**No saltarse el paso 4.** Si el ticket es trivial (typo, cambio de un valor,
ajuste de config de una línea), se puede saltar spec/plan e ir directo — pero
decirlo explícitamente ("ticket trivial, salto SDD") en vez de asumirlo en silencio.

## 1. Spec — qué y por qué

Usa `templates/spec-template.md`. Reglas:

- **Nada de detalles de implementación** — la spec describe comportamiento
  observable, no código, frameworks, ni estructura de archivos.
- Historias de usuario priorizadas (P1, P2, P3...) — cada una debe ser
  **independientemente testeable**: si solo se implementa la P1, ya hay valor
  entregable.
- Requisitos funcionales numerados (`FR-001`, `FR-002`...) — si algo no está
  claro en el ticket original, márcalo explícito: `[NEEDS CLARIFICATION: ...]`
  y pregúntale al developer/PM en vez de asumir.
- Criterios de éxito medibles y agnósticos de tecnología (`SC-001`...) — "el
  usuario completa el registro en menos de 2 minutos", no "el endpoint responde
  en 200ms" (eso va en el plan).

## 2. Plan — cómo

Usa `templates/plan-template.md`. Reglas:

- Contexto técnico explícito: lenguaje/stack, dependencias principales,
  storage, testing, plataforma objetivo — usa `[NEEDS CLARIFICATION]` si algo
  no está decidido, nunca lo inventes.
- Estructura de carpetas/archivos concreta para *esta* historia — no genérica.
- Si el plan viola alguna convención del stack pack correspondiente (ej.
  layered-architecture en java-spring), regístralo en "Complexity Tracking"
  con la razón — no lo hagas en silencio.

## 3. Tasks — lista ejecutable

Desglosa el plan en tareas ordenadas y verificables, agrupadas por historia de
usuario cuando aplique (permite entregar P1 sola como MVP). Cada tarea debe ser
lo bastante chica para verificarse de forma independiente.

## 4. Aprobación

Presenta spec + plan + tasks al developer. Espera confirmación explícita antes
de generar código. En proyectos legacy (ver reglas de MYSCIE en CLAUDE.md) esto
aplica siempre, sin excepción — nunca trabajar "full" solo en legacy.

## 5. Implement

Ejecuta tarea por tarea. Verifica cada checkpoint (build pasa, test pasa) antes
de seguir a la siguiente. Si una tarea revela que el plan estaba mal, para y
vuelve a §2 en vez de improvisar sobre la marcha.

## Cuándo usar el toolkit completo de spec-kit

Este skill es la versión ligera (solo spec.md + plan.md, sin scripts). Si un
proyecto necesita el flujo completo de spec-kit (constitution.md, clarify,
analyze, checklist, numeración automática de features, multi-agente) se puede
instalar el toolkit original directo:

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init --ai claude --skills
```

---
_Kiritek Framework — skill core `spec-driven-dev`. Metodología adaptada de [github/spec-kit](https://github.com/github/spec-kit) (MIT), reescrita como skill ligera sin dependencias de scripts._
