# Propuesta: Framework Kiritek

**Presentan:** Vladimir, Oscar y Miguel
**Fecha de presentación:** Lunes 13 de julio de 2026, 4:00 pm

---

## La propuesta

Un comando único, `npx kiritek-init`, que deja cualquier proyecto de Kiritek
configurado con el stack de IA obligatorio: skills, agentes, indexado de
código y memoria persistente. Mismo mínimo para todos, sin importar quién
tome el proyecto.

```bash
npx kiritek-init
```

No es solo idea — ya hay contenido real construido (skills core + 3 stack
packs). Detalle de archivos, fuentes y licencias en `kiritek-init/ESTADO-PROYECTO.md`.

---

## Qué hace `kiritek-init`

1. **Detecta** el/los stack(s) del proyecto (lee `pom.xml`, `pubspec.yaml`, `package.json`, `requirements.txt`...) y confirma con el developer.
2. Instala **skills core** (todo proyecto) + **stack pack(s)** correspondientes (aditivo — un proyecto full-stack instala varios).
3. Orquesta **Graphify** (indexado de código) y **claude-mem-lite** (memoria persistente entre sesiones).
4. Genera `CLAUDE.md`/`AGENTS.md` sin pisar contenido custom existente.

Otros comandos: `--stack=java-spring,react` (salta detección, útil en CI) · `audit` (chequeo de cumplimiento on-demand) · `update` (re-sincroniza sin pisar personalizaciones).

---

## Qué instala

### Skills core (obligatorias, todo proyecto)

| Skill             | Qué hace                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-workflow`    | Conventional commits, branch naming `feature/TICKET-123-...` (conecta con Jira), reglas no-negociables (nunca push directo a main, nunca force sin lease) |
| `spec-driven-dev` | spec → plan → tasks → **aprobación humana** → implementación, con templates reales                                                                        |
| `mcp-jira`        | Trae el ticket, confirma entendido, comenta al cerrar, nunca transiciona estado sin humano                                                                |

### Stack packs (según detección)

| Stack                                   | Skills                                                                                                    | Estado        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| `java-spring` (Boot 3.x)                | layered-architecture, testing-pyramid, spring-data-jpa, flyway-migrations, transactional-patterns         | ✅ Construido |
| `flutter` (BLoC/Cubit)                  | dart-flutter-patterns, flutter-dart-code-review, owasp-mobile-security-checker (+4 scripts Python reales) | ✅ Construido |
| `python` (FastAPI)                      | fastapi (skill oficial FastAPI), python-testing                                                           | ✅ Construido |
| `react` / `vue` / `angular` / `express` | —                                                                                                         | ⏳ Pendiente  |

### Resto del stack

| Pieza               | Decisión                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CodeGraph           | **Graphify** — indexa código + docs/PDFs, resuelve el problema de reglas de negocio no escritas en MYSCIE                                                                         |
| Memoria persistente | **claude-mem-lite** — namespace por proyecto por defecto (se descartó _claude-mem_ original: sin aislamiento real entre proyectos, casos reales de sesiones de $2 a $25 en costo) |
| Agentes             | dev-front, dev-back, QA + orquestador, tope 2–3 reintentos — ⏳ pendiente de construir                                                                                            |
| Front               | Playwright — captura antes/después de cada cambio visual                                                                                                                          |

MYSCIE (legacy multi-tecnología) queda fuera del ajuste fino por stack — sigue bajo reglas generales: la IA nunca toca carpetas de terceros, nunca trabaja "full" sola ahí.

---

## Agente auditor (requisito explícito)

Rutina programada (estilo KIRA), semanal, por repo de POD. Primero chequea lo objetivo: CLAUDE.md/AGENTS.md presente, skills obligatorias instaladas, convención de commits. Publica un `.md` de estado de cumplimiento en el repo de conocimiento — no solo alerta por correo, para tener visibilidad histórica.

---

## Estructura de repos

**Un repositorio por POD** (consistente con Kirinova/Taneforus). Base de conocimiento compartida vive en un repo central del que cada POD hereda vía `kiritek-init` — un solo punto de actualización.

---

## Estado del CLI

| Componente                                   | Estado        |
| -------------------------------------------- | ------------- |
| Skills core + 3 stack packs                  | ✅ Construido |
| `.graphifyignore` base                       | ✅ Construido |
| Stack packs react/vue/angular/express        | ⏳ Pendiente  |
| CLI (`detect`/`install`/`audit`)             | ⏳ Pendiente  |
| Agentes (orchestrator/dev-front/dev-back/QA) | ⏳ Pendiente  |
| Publicación npm                              | ⏳ Pendiente  |

---

## Puntos abiertos

- Automatización de asignación de tickets: ¿la IA arranca sola tickets simples o siempre media una persona? — decidir hoy.
- Migración CodeCommit → GitHub: pendiente análisis de Alan; condiciona acceso directo de PMs a GitHub/Claude.
- claude-mem-lite solo corre en Linux/macOS — confirmar si hay developers en Windows.

---

## Próximos pasos

| Acción                                          | Responsable             | Fecha                |
| ----------------------------------------------- | ----------------------- | -------------------- |
| Decidir automatización de asignación de tickets | Vladimir, Oscar, Miguel | Hoy                  |
| Completar stack packs restantes                 | Por asignar             | Post-propuesta       |
| Construir CLI + agentes                         | Por asignar             | Post-propuesta       |
| Análisis migración CodeCommit → GitHub          | Alan                    | Pendiente de agendar |
| Sumar a Heriberto y Joana                       | Vladimir, Oscar, Miguel | Etapa 1              |
