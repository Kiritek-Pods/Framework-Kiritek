# Estado del proyecto — `kiritek-init`

**Última actualización:** 12 de julio de 2026
**Para:** presentación de la propuesta Framework Kiritek (13 de julio, 4:00 pm)

Este documento explica qué es `kiritek-init`, qué se construyó ya de forma
concreta (no solo como idea) y qué falta. Es el complemento técnico de
`propuesta-framework-kiritek.md`.

---

## 1. Qué es `kiritek-init`

Un paquete instalable vía `npx kiritek-init` que configura, en un solo comando,
el mínimo obligatorio del Framework Kiritek en cualquier proyecto: skills,
agentes, indexado de código (Graphify) y memoria persistente (claude-mem-lite).

```bash
npx kiritek-init
```

Detecta el/los stack(s) del proyecto (Java/Spring, Flutter, Python/FastAPI, y
próximamente React/Vue/Angular/Express), confirma con el developer, e instala:

1. **Skills core** (siempre, sin importar el stack)
2. **Stack pack(s)** correspondientes (aditivos — un proyecto full-stack instala varios)
3. **Graphify** (indexado de código + docs)
4. **claude-mem-lite** (memoria persistente entre sesiones)

## 2. Qué existe ya, de verdad, en este repo

No es solo diseño — ya hay contenido real, curado y adaptado, listo para
empaquetarse. Todo vive bajo `templates/`:

### 2.1 Skills core (`templates/core/`) — obligatorias en todo proyecto

| Skill | Contenido | Origen | Licencia |
|---|---|---|---|
| `git-workflow` | Conventional commits, commits atómicos, branch naming `feature/TICKET-123-...` (conectado a la clave de Jira), reglas no-negociables (no push a main, no force sin lease, etc.) | Adaptado de [netresearch/git-workflow-skill](https://github.com/netresearch/git-workflow-skill) | MIT + CC-BY-SA-4.0 |
| `mcp-jira` | Flujo Kiritek sobre el servidor MCP **oficial** de Atlassian: traer ticket → confirmar entendido → branch/commit con clave del ticket → comentar al cerrar → nunca transicionar estado sin humano | Contenido propio de Kiritek, sobre [atlassian/atlassian-mcp-server](https://github.com/atlassian/atlassian-mcp-server) | Apache-2.0 (servidor) |
| Spec Kit | Metodología spec → plan → tasks → aprobación → implement (`/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, etc.). No es un skill empaquetado en `templates/`: `kiritek-init` corre el CLI **oficial** de GitHub (`uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude`) en cada proyecto — sin fork ni reescritura propia | [github/spec-kit](https://github.com/github/spec-kit) (oficial de GitHub) | MIT |
| `.graphifyignore` | Reglas base: excluye deps de terceros, artefactos generados, y sección explícita para marcar frameworks legacy vendored (regla MYSCIE: nunca indexar ni tocar terceros) | Propio de Kiritek | — |

### 2.2 Stack packs (`templates/stacks/`) — según detección del proyecto

**`java-spring`** (Spring Boot 3.x — mayoría de proyectos activos; MYSCIE queda
fuera de este ajuste fino por ser legacy multi-tecnología):

- `layered-architecture` — Controller → Service → Repository, DTOs, mappers
- `testing-pyramid` — unit/slice/integration, Testcontainers, convenciones de naming
- `spring-data-jpa` — entidades, N+1, proyecciones, paginación keyset
- `flyway-migrations` — versionado de BD (se prefirió sobre Goose, mencionado por César, por ser el estándar nativo Spring)
- `transactional-patterns` — propagación, self-invocation, eventos post-commit

Origen: [rrezartprebreza/spring-boot-skills](https://github.com/rrezartprebreza/spring-boot-skills) (MIT), subset de 5 de sus 19 skills — se descartaron las que no aplican hoy (DDD, hexagonal, OAuth2, Spring Batch, etc.)

**`flutter`** (estándar de state management: **BLoC/Cubit**, no Riverpod):

- `dart-flutter-patterns` — null safety, widget architecture, BLoC, GoRouter, Dio, testing (nota agregada priorizando BLoC sobre Riverpod)
- `flutter-dart-code-review` — checklist completo library-agnostic (performance, accesibilidad, seguridad, i18n)
- `owasp-mobile-security-checker` — **4 scripts Python funcionales** (no solo docs): detección de secrets hardcodeados, dependencias vulnerables, seguridad de red, seguridad de storage — relevante para apps con datos sensibles (ej. Skolable)

Origen: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) + [Harishwarrior/flutter-claude-skills](https://github.com/Harishwarrior/flutter-claude-skills) (ambos MIT)

**`python`** (FastAPI):

- `fastapi` — skill **oficial** de los mantenedores de FastAPI (no de comunidad), con 6 archivos de referencia (dependencies, pydantic, streaming/SSE, path-operations, responses, other-tools)
- `python-testing` — pytest completo: fixtures, parametrize, async, mocking, TDD, config `pyproject.toml`

Origen: [fastapi/fastapi](https://github.com/fastapi/fastapi) (oficial) + [laurigates/claude-plugins](https://github.com/laurigates/claude-plugins) (ambos MIT)

**Pendientes**: `react`, `vue`, `angular`, `express` — mismo proceso (buscar candidato de comunidad → filtrar subset relevante → adaptar), pausado para priorizar la entrega de mañana.

### 2.3 Piezas evaluadas y decididas (no vendorizadas como archivo — son herramientas externas orquestadas por el instalador)

| Pieza | Decisión | Nota |
|---|---|---|
| **CodeGraph** | [Graphify](https://github.com/safishamsi/graphify) | CLI aparte (`uv tool install graphifyy`), genera su propio skill al correr `graphify install`. Indexa código + docs/PDFs — encaja con el problema real de MYSCIE (reglas de negocio no escritas). |
| **Memoria persistente** | [claude-mem-lite](https://github.com/sdsrss/claude-mem-lite) (no el `claude-mem` original que mencionó César) | Cambio de decisión tras evaluar riesgos reales: el original no aísla memoria por proyecto (issues #1256, #683 en su propio repo) y tiene reportes de sesiones que escalan de $2 a $25 en costo. claude-mem-lite es project-scoped por defecto, MIT, ~600x más barato estimado. Limitación: solo Linux/macOS. |

## 3. Qué falta para tener el CLI funcional

Todo lo de arriba es **contenido** (los templates que se van a instalar). Falta
la **herramienta** que los instala:

- `bin/kiritek-init.js` — entrypoint
- `src/detect.js` — auto-detección de stack (lee `pom.xml`/`build.gradle`, `pubspec.yaml`, `package.json`+deps, `requirements.txt`/`pyproject.toml`)
- `src/installer.js` — copia templates al proyecto destino, con merge (no overwrite ciego) y orquestación de Graphify + claude-mem-lite
- `src/audit.js` — chequeo de cumplimiento (agente auditor, ver propuesta §7)
- `package.json` — para publicar como `npx kiritek-init`
- Agentes: `orchestrator`, `dev-front`, `dev-back`, `QA` (core + variantes por stack) — no construidos aún
- `CLAUDE.md`/`AGENTS.md` (templates base que genera el instalador)
- `kiritek-audit.config.json` — qué chequea el auditor

Diseño completo de carpetas: ver `kiritek-init-design.md` en la raíz del repo.

## 4. Cómo probar lo que ya existe (manual, sin el CLI aún)

Mientras no existe el comando, cualquiera puede copiar el pack a mano para
validar el contenido:

```bash
cp -r kiritek-init/templates/core/.claude mi-proyecto/.claude
cp kiritek-init/templates/core/.graphifyignore mi-proyecto/
cp -r kiritek-init/templates/stacks/java-spring/.claude/skills/* mi-proyecto/.claude/skills/
```

## 5. Licencias — resumen para legal/compliance

Todo el contenido adaptado es MIT, Apache-2.0, o MIT+CC-BY-SA-4.0 (git-workflow
únicamente — requiere mantener atribución, ya incluida como footer en cada
archivo). Ningún componente tiene licencia restrictiva o copyleft fuerte (GPL).
Cada `SKILL.md` adaptado lleva su footer de atribución al origen.
