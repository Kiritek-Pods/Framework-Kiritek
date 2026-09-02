# Kiritek — cheat sheet

## Instalar (una vez por proyecto)

```bash
npx github:Kiritek-Pods/Framework-Kiritek#npx-release init
```

Detecta el stack y confirma antes de instalar. Si detecta mal:
```bash
npx github:Kiritek-Pods/Framework-Kiritek#npx-release init --stack=java-spring,react
```

## Flujo diario (con Claude Code)

```
1. Traer ticket (Jira, si instalaste mcp-jira)  -> skill mcp-jira      [opcional]
2. Spec + plan, aprobar humano                  -> /speckit.specify + /speckit.plan (Spec Kit oficial) ⚠️ no saltarse salvo fix trivial
3. Implementar por capa/stack                   -> orchestrator delega a dev-back-*/dev-front-*
4. QA antes de PR                               -> agente qa
5. Branch + commits + PR                        -> skill git-workflow       ⚠️ nunca push directo a main
6. Cerrar ticket (si instalaste mcp-jira)       -> skill mcp-jira            ⚠️ nunca transiciona estado sin humano
7. Revisión humana                              -> siempre, antes de producción
```

## Comandos

`KIRITEK="npx github:Kiritek-Pods/Framework-Kiritek#npx-release"` (guárdalo así en tu shell y usa `$KIRITEK` abajo, o pega el comando completo cada vez)

| Comando | Qué hace |
|---|---|
| `$KIRITEK init` | Instala/completa el mínimo (no pisa lo que ya existe) |
| `$KIRITEK update` | Resincroniza templates nuevos sin pisar personalizaciones |
| `$KIRITEK audit` | Chequea cumplimiento + genera `kiritek-compliance.md` — **manual**, no corre solo |
| `graphify .` | Regenera el índice de código — correr cuando el código cambió mucho desde la última vez (Graphify no se actualiza solo) |

## Branch naming / commits

```
feature/TICKET-123-descripcion
fix/TICKET-456-bug-name

feat: descripción       (MINOR)
fix: descripción        (PATCH)
docs, style, refactor, perf, test, build, ci, chore, revert
```

## Reglas no-negociables

- No push directo a main.
- No force-push sin `--force-with-lease`.
- No "tested/verified" sin output real de comando pegado.
- No implementar sin spec aprobado (salvo fix trivial de una línea).
- No cerrar ticket ni pasar a producción sin humano.

## Stacks soportados

`java-spring` · `flutter` · `python` · `express` · `react` · `vue`

## Problemas comunes

| Síntoma | Solución |
|---|---|
| Graphify pide instalar `uv` | Decir que sí, sigue solo |
| `CLAUDE.md` ya existe, no se actualiza | Normal — fusionar a mano si se quiere |
| Detectó stack equivocado | `--stack=nombre1,nombre2` |

Detalle completo: [`README.md`](./README.md)
