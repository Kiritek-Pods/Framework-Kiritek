# Adaptadores de superficie (T14)

Todas las superficies consumen el MISMO core (`guardrails scan` →
`evaluateRun`); ninguna reimplementa reglas. Son independientes de los
adaptadores de `core/security` (archivos, marcador y comandos propios) y
**warning-first**: sólo un deny elegible del core bloquea; un fallo del
adaptador o del CLI nunca bloquea (a diferencia de security, que es
fail-closed).

| Superficie | Momento | Bloqueo | Fallo propio |
|---|---|---|---|
| Kiro (`hook kiro`) | agent | exit 2 sólo con deny elegible; allow/warn ⇒ exit 0 + feedback en stderr; sin `ask` | exit 0 con aviso |
| Claude (`hook claude`) | agent | `permissionDecision: deny` sólo con deny elegible; warn ⇒ `allow` o `ask` (`--warn-as`) | `allow` con razón |
| Git pre-commit | pre-commit | exit 1 del core (deny elegible) | no bloquea |
| CI / PR | pr | exit 1 del core | error operativo (3/4), nunca deny |
| Release | release | exit 1 del core | error operativo |

- **agent / pre-commit** sólo validan contratos y manifests: los harness
  conductuales se difieren a PR/release (`BEHAVIOR_DEFERRED`). En `agent`, los
  findings "completables en el mismo cambio" (`required-signal-missing`,
  `metadata-invalid`, `contract-invalid`, …) nunca bloquean.
- **Eventos de agente** (`events.js`): sólo se leen rutas conocidas de
  `tool_input`; contenido, comandos y prompts no salen. Payloads malformados
  devuelven un código, no lanzan. Tools opacas (Bash, shell, MCP, AWS) no se
  evalúan: quedan declaradas como no interceptables.
- **Git** (`git.js`): staged exacto, offline. Sin hook ⇒ instala dispatcher;
  hook del usuario ⇒ lo preserva y encadena; hook de security, Husky/Lefthook/
  pre-commit/CaptainHook o `core.hooksPath` ⇒ integración manual con la línea
  `INVOCATION`, verificable con `verifyGitIntegration` (el audit no atribuye
  protección si no está cableada).
- **CI** (`ci.js`): el workflow sólo invoca el CLI con contexto vía `env`, sin
  secretos (forks) y con `fetch-depth: 0`; un checkout shallow sin base es
  `SCOPE_RANGE_INCOMPLETE` (operativo). `toAnnotations` produce anotaciones
  neutrales (heurística nunca `failure`; error operativo `notice`).
- **Release**: `--moment=release --unit=<id> --artifact=<ref> --revision=<sha>`.
- **Cobertura** (`coverage.js`): matriz control × superficie (`covered` /
  `pending` con superficie posterior) y operaciones no interceptables
  (`unavailable`), expuestas en `guardrails audit`.

Enlace: `kiritek-init guardrails install --surfaces=kiro,claude,git,ci`
(idempotente; `uninstall` quita sólo lo engineering y restaura el hook previo).
