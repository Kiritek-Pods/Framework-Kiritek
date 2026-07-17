---
name: git-workflow
description: "Use when establishing branching strategies, implementing Conventional Commits, creating or reviewing PRs, resolving PR review comments, merging PRs (including CI verification, auto-merge queues, and post-merge cleanup), managing PR review threads, merging PRs with signed commits, handling merge conflicts, integrating Git with CI/CD, setting up git hooks (lefthook, captainhook, husky, pre-commit), or debugging hook-install failures in git worktrees. Not for creating releases (use github-release) or diagnosing BLOCKED/won't-merge PRs (use github-project)."
license: "(MIT AND CC-BY-SA-4.0). See LICENSE-MIT and LICENSE-CC-BY-SA-4.0"
compatibility: "Requires git, gh CLI; yq for .spec-cleanup.yml."
metadata:
  author: Netresearch DTT GmbH
  version: "1.18.4"
  repository: https://github.com/netresearch/git-workflow-skill
allowed-tools: Bash(git:*) Bash(gh:*) Read Write
---

# Git Workflow Skill

## Critical Rules (Non-Negotiable)

> **Kiritek:** de las 11 referencias del skill original solo se incluyó `commit-conventions.md` — cubre lo obligatorio (conventional commits, atomic commits, push upstream). El resto (PR workflow avanzado, merge-gate, hooks, CI/CD) queda como pendiente de evaluar contra la skill de PRs que César ya construyó, para no duplicar/chocar. Firma de commits (`-S --signoff`/DCO) es **opcional** hasta que se resuelva la migración CodeCommit → GitHub y se sepa qué exige el repo destino.

1. **No direct push to main** — always open a PR.
2. **No squash unless asked** — preserves atomic commits, signatures, bisection.
3. **No "tested/verified/working" without pasted command output** — else say so.
4. **No edits to installed skill/plugin cache paths** (`~/.claude/skills/`, `~/.claude/plugins/cache/`, `**/.bare/**`) — always the repo worktree, verified by `pwd`.
5. **Force-push only with `--force-with-lease`** — never plain `--force`.
6. **Commit before rebase** — `add → commit → fetch → rebase → push`. Dirty tree aborts rebase.
7. **No editorializing** — state what changed, not how good it is; no narrating expected results or self-praise.

## Reference Files

| Reference | Content Triggers |
|-----------|-----------------|
| `references/commit-conventions.md` | Conventional commits, atomic commits, signed commits/DCO (opcional) |

## Conventional Commits

```
<type>[scope]: <description>
```

**Types**: `feat` (MINOR), `fix` (PATCH), `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Breaking change**: Add `!` after type or `BREAKING CHANGE:` in footer.

## Branch Naming

```
feature/TICKET-123-description
fix/TICKET-456-bug-name
release/1.2.0
hotfix/1.2.1-security-patch
```

> **Kiritek:** `TICKET-123` = clave del ticket de Jira — mantiene la referencia entre el commit/branch y la historia, clave para que el MCP Jira (skill `mcp-jira`) actualice el ticket correcto al cerrar.

## Hook Detection

Detect hooks first:

```bash
ls lefthook.yml .lefthook.yml captainhook.json .pre-commit-config.yaml .husky/pre-commit 2>/dev/null || echo "No hooks"
```

Install: `lefthook install` | `composer install` | `npm install` | `pre-commit install`

## Critical Release Rules

1. **Immutable releases**: deleted releases block tag reuse; bump version.
2. **Multi-branch releases**: Use `--latest=false` from non-default branches.
3. **Pre-release**: Version bumped, CI green, CHANGELOG updated, `git pull` BEFORE `gh release create`.

## PR Merge Requirements

Before merging: threads resolved, CI green (incl. annotations), rebased. **Revisión humana siempre requerida antes de producción** (ver propuesta Framework Kiritek §6). Signed commits opcional — ver nota arriba.

---
_Kiritek Framework — skill core `git-workflow`. Adaptado de [netresearch/git-workflow-skill](https://github.com/netresearch/git-workflow-skill) (MIT + CC-BY-SA-4.0 para el contenido — mantiene atribución por los términos de CC-BY-SA)._
