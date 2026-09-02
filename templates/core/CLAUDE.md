# Proyecto — Kiritek Framework

Este proyecto usa el **Framework Kiritek**. Reglas obligatorias:

- **Spec antes de código**: usa [Spec Kit](https://github.com/github/spec-kit) (`/speckit.specify`, `/speckit.plan`, `/speckit.tasks`) — no se implementa sin spec+plan aprobado, salvo fixes triviales de una línea.
- **Git**: ver skill `git-workflow` — conventional commits, no push directo a main, no force sin `--force-with-lease`.
{{JIRA_LINE}}- **Revisión humana siempre requerida antes de producción.**

## Stacks detectados en este proyecto

{{STACKS}}

## Indexado de código

Este proyecto usa [Graphify](https://github.com/safishamsi/graphify) para indexar código y documentación. Corre `graphify .` para regenerar el grafo si el código cambió mucho desde la última vez.

## Memoria persistente

Este proyecto usa `claude-mem-lite` (project-scoped) para memoria entre sesiones. Ver skill/config instalada por `npx kiritek-init` si necesitas reconfigurarla.

---
_Generado por `kiritek-init`. Editable — `kiritek-init update` no sobreescribe este archivo si ya existe._
