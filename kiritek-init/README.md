# kiritek-init

Un comando deja cualquier proyecto de Kiritek con el mínimo obligatorio de IA:
skills, agentes, indexado de código y memoria persistente. Mismo punto de
partida para todos, sin importar quién tome el proyecto.

```bash
npx github:Kiritek-Pods/Framework-Kiritek#npx-release init
```

(requiere acceso SSH/gh al repo — el mismo que ya usas para clonar)

---

## 1. Instalación

Corre el comando de arriba **dentro del repo del proyecto**, no en una carpeta vacía.

1. **Detecta el stack** — lee `pom.xml`/`build.gradle` (Java/Spring), `pubspec.yaml` (Flutter), `requirements.txt`/`pyproject.toml` (Python), `package.json` (Express/React) — y te confirma antes de instalar. Si detecta mal o quieres saltarte la detección:
   ```bash
   npx github:Kiritek-Pods/Framework-Kiritek#npx-release init --stack=java-spring,react
   ```
2. **Instala el core** (siempre, sin importar stack): skill `git-workflow`; agentes `orchestrator` y `qa`; `.graphifyignore`; `kiritek-audit.config.json`; y [Spec Kit](https://github.com/github/spec-kit) oficial de GitHub (vía `uvx`, sin fork ni versión propia — instala `uv` primero si hace falta, con confirmación).
3. **Instala el/los stack pack(s)** detectados — skills + agente `dev-back-*`/`dev-front-*` correspondiente. Es aditivo: un proyecto full-stack (ej. Java + React) instala ambos sin conflicto.
4. **Pregunta si quieres la integración con Jira** (skill `mcp-jira`, opcional — no todo proyecto usa Jira o tiene el MCP de Atlassian conectado). Saltable con `--jira=false` / `--jira=true`.
5. **Genera `CLAUDE.md`/`AGENTS.md`** — solo si no existen ya. Si el proyecto ya tiene uno con contenido custom, no lo toca (avisa que lo saltó). Solo menciona Jira ahí si la instalaste.
6. **Pregunta si quieres configurar Graphify** (indexado de código). Si no tienes `uv` instalado, te pregunta explícitamente si quiere instalarlo — nunca lo hace sin confirmar.
7. **`claude-mem-lite`** no se instala automático — imprime instrucciones (requiere Linux/macOS, setup manual).

Nada de esto sobreescribe algo que ya exista en el proyecto. Si corres `init` dos veces, la segunda solo llena lo que falta.

## 2. Stacks soportados

| Stack | Se detecta por | Agente | Skills |
|---|---|---|---|
| `java-spring` | `pom.xml`/`build.gradle` con `spring-boot` | `dev-back-java` | layered-architecture, spring-data-jpa, flyway-migrations, transactional-patterns, testing-pyramid |
| `flutter` | `pubspec.yaml` con `sdk: flutter` | `dev-front-flutter` | dart-flutter-patterns, flutter-dart-code-review, owasp-mobile-security-checker |
| `python` | `requirements.txt`/`pyproject.toml` | `dev-back-python` | fastapi, python-testing |
| `express` | `package.json` con dependencia `express` | `dev-back-node` | node-express-patterns, node-testing |
| `react` | `package.json` con dependencia `react` | `dev-front-react` | react-patterns, react-testing |
| `vue` | `package.json` con dependencia `vue` | `dev-front-vue` | vue-patterns, vue-testing |

`angular` — pendiente, mismo proceso si se necesita.

## 3. Flujo de trabajo diario (con Claude Code, ya instalado el framework)

Este es el flujo que las skills/agentes instalados hacen cumplir:

1. **Traer el ticket** (si instalaste `mcp-jira`) — pídele a Claude que traiga el ticket de Jira. Confirma que entendió el alcance antes de seguir. Sin `mcp-jira`, arranca directo del paso 2 con el alcance que le des a mano.
2. **Spec antes de código** — `/speckit.specify` genera spec (qué/por qué), `/speckit.plan` genera el plan (cómo), `/speckit.tasks` la lista de tareas — via [Spec Kit](https://github.com/github/spec-kit) oficial (instalado automático en el paso 2 de la instalación, ver abajo). **No se implementa nada sin aprobación humana explícita del spec+plan**, salvo fixes triviales de una línea.
3. **Implementación, delegada por capa** — si el ticket toca varias capas/stacks, el agente `orchestrator` reparte el trabajo entre los agentes de stack instalados (`dev-back-java`, `dev-front-react`, etc.). Cada uno sigue las skills de su stack (arriba).
4. **QA antes de PR** — el agente `qa` revisa contra el spec, corre tests existentes, busca casos borde. No inventa "probado/funciona" sin output real de comando.
5. **Git al cierre** — la skill `git-workflow` se encarga de: branch `feature/TICKET-123-descripcion` (clave de Jira incluida), Conventional Commits, nunca push directo a main, nunca `--force` sin `--force-with-lease`.
6. **Cerrar el ticket** (si instalaste `mcp-jira`) — comenta al cerrar. **Nunca transiciona estado de Jira sin confirmación humana.**
7. **Revisión humana siempre requerida antes de producción** — ningún paso de este flujo la reemplaza.

No hace falta invocar cada skill/agente por nombre — Claude Code las activa solo cuando el contexto matchea (ej. mencionar un ticket activa `mcp-jira`, tocar una entidad JPA activa `spring-data-jpa`).

## 4. Mantener el proyecto al día

```bash
npx github:Kiritek-Pods/Framework-Kiritek#npx-release update
```

Re-sincroniza templates nuevos (ej. si sale un stack pack nuevo) sin pisar lo que ya personalizaste.

## 5. Auditoría y métricas de adopción

```bash
npx github:Kiritek-Pods/Framework-Kiritek#npx-release audit
```

Chequea que el mínimo siga instalado y calcula qué % de los últimos commits sigue Conventional Commits. Queda registrado en `kiritek-compliance.md` del propio repo (histórico, nunca se borra).

Para que esto se reporte automático cada semana y se sume a las métricas de adopción del framework a nivel Kiritek (no solo este repo), ver [`metrics/README.md`](./metrics/README.md) — 10 minutos de setup por repo, sin depender de infra.

## 6. Problemas comunes

- **"graphify: necesita `uv` y no está instalado. ¿Instalarlo ahora...?"** — dile que sí y sigue solo. Si dices que no, instala `uv` manual (`curl -LsSf https://astral.sh/uv/install.sh | sh`) y vuelve a correr `init`.
- **"docs: ya existe, no se sobreescribe -> CLAUDE.md"** — normal si el proyecto ya tenía su propio `CLAUDE.md`. Si quieres las reglas Kiritek ahí, hay que fusionar a mano.
- **Detectó el stack equivocado o ninguno** — usa `--stack=nombre1,nombre2` para saltarte la detección.
