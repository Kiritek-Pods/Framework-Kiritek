# Diseño de carpetas — `kiritek-init`

## 1. Repo del paquete (fuente, se publica a npm)

```
kiritek-init/
├── package.json
├── README.md
├── bin/
│   └── kiritek-init.js          # entrypoint CLI (shebang node)
├── src/
│   ├── cli.js                    # parseo de comandos: init, audit, update
│   ├── detect.js                 # auto-detección de stack(s) del proyecto
│   ├── installer.js              # copia templates -> proyecto destino
│   ├── prompts.js                # confirmación interactiva post-detección
│   └── audit.js                  # lógica del agente auditor (chequeo + .md)
├── templates/
│   ├── core/                     # obligatorio siempre
│   │   ├── CLAUDE.md
│   │   ├── AGENTS.md
│   │   ├── .graphifyignore       # base Kiritek — nunca indexar frameworks/terceros
│   │   ├── .claude/
│   │   │   ├── skills/
│   │   │   │   ├── git-workflow/SKILL.md          (+ references/commit-conventions.md)
│   │   │   │   ├── spec-driven-dev/SKILL.md        (+ templates/spec-template.md, plan-template.md)
│   │   │   │   └── mcp-jira/SKILL.md
│   │   │   └── agents/
│   │   │       └── orchestrator.md
│   │   └── kiritek-audit.config.json
│   │
│   └── stacks/                   # opcional, según detección
│       ├── java-spring/
│       │   ├── .claude/skills/folder-structure/SKILL.md
│       │   └── .claude/agents/dev-back.md
│       ├── flutter/
│       │   ├── .claude/skills/folder-structure/SKILL.md
│       │   └── .claude/agents/dev-front.md
│       ├── react/
│       │   ├── .claude/skills/folder-structure/SKILL.md
│       │   ├── .claude/agents/dev-front.md
│       │   └── .claude/skills/playwright-visual-flow/SKILL.md
│       ├── vue/          (misma forma que react)
│       ├── angular/      (misma forma que react)
│       ├── express/
│       │   ├── .claude/skills/folder-structure/SKILL.md
│       │   └── .claude/agents/dev-back.md
│       └── python/
│           ├── .claude/skills/folder-structure/SKILL.md
│           └── .claude/agents/dev-back.md
│
└── test/
    └── detect.test.js
```

## 2. Qué queda en el proyecto destino después de `npx kiritek-init`

Ejemplo: proyecto con back Java/Spring Boot + front React (detectado y confirmado).

```
mi-proyecto/
├── CLAUDE.md                     # generado, incluye stacks detectados
├── AGENTS.md                     # mismo contenido, formato universal
├── .graphifyignore                ← core (mergeado con .gitignore del proyecto)
├── .claude/
│   ├── skills/
│   │   ├── git-workflow/SKILL.md            ← core (commits, branch naming)
│   │   ├── spec-driven-dev/SKILL.md         ← core (spec+plan+tasks antes de codear)
│   │   ├── mcp-jira/SKILL.md                ← core (conecta MCP oficial Atlassian)
│   │   ├── layered-architecture/SKILL.md    ← stack pack (java-spring, ejemplo)
│   │   └── dart-flutter-patterns/SKILL.md   ← stack pack (flutter, ejemplo)
│   └── agents/
│       ├── orchestrator.md       ← core
│       ├── dev-back.md           ← stack pack (java-spring)
│       └── dev-front.md          ← stack pack (react)
├── graphify-out/                 ← generado por `graphify .` (graph.html, GRAPH_REPORT.md, graph.json)
├── kiritek-audit.config.json     ← core (qué chequea el auditor)
└── kiritek-compliance.md         ← generado por el auditor (histórico, no borrar)
```

**Graphify no se "instala" copiando archivos** — es una herramienta CLI aparte (`uv tool install graphifyy`) que genera su propio SKILL.md al correr `graphify install`. El paso de `kiritek-init` es orquestar esa instalación, no vendorizar su skill:

```bash
# Dentro del installer de kiritek-init, si graphify no está disponible:
uv tool install graphifyy
graphify install          # crea su propio skill/slash-command /graphify
graphify claude install   # escribe hooks PreToolUse + nota en CLAUDE.md
# .graphifyignore de Kiritek ya se copió como parte de core, antes de este paso
graphify .                 # primer build del grafo (o se deja para el primer uso real)
```

## 3. Comandos del CLI

- `npx kiritek-init` — detecta stack(s), confirma con el developer, instala core + stack packs correspondientes, y orquesta la instalación de Graphify (ver §2).
- `npx kiritek-init --stack=java-spring,react` — salta la detección, instala directo (para CI o casos donde la detección falle).
- `npx kiritek-init audit` — corre el chequeo de cumplimiento localmente y actualiza `kiritek-compliance.md` (misma lógica que la rutina programada tipo KIRA, pero on-demand).
- `npx kiritek-init update` — re-copia templates core/stack sin tocar lo que el proyecto ya personalizó (merge, no overwrite ciego).

## 4. Reglas de instalación

- **No sobreescribe sin avisar**: si `CLAUDE.md` ya existe con contenido custom, hace merge o pide confirmación antes de tocar.
- **Stack packs son aditivos**: un proyecto con Java + React instala ambos folder-structure y ambos dev-agents sin conflicto (viven en subcarpetas separadas dentro de `.claude/skills` y `.claude/agents`).
- **`kiritek-compliance.md` nunca se sobreescribe por `kiritek-init`** — solo lo toca `audit`, para mantener histórico real.

---

**Pendiente de definir antes de codear (siguiente paso):** contenido real de cada `SKILL.md` core (qué dice exactamente commit-conventions, gitflow, spec-driven-dev, mcp-jira) y de los agentes core/stack (dev-front, dev-back, QA, orchestrator).
