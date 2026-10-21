# Seguridad integral de Kiritek — guía operativa (hub)

Este documento es el **centro** de la documentación de seguridad de
`kiritek-init`. Describe la arquitectura, la matriz de controles por etapa, los
defaults, los flags, la precedencia de configuración, los estados y exit codes,
y la evidencia. Enlaza a los documentos especializados en vez de duplicarlos.

> **Honestidad por diseño.** Kiritek nunca declara `verified`/`tested`/`cumple`
> sin evidencia vigente del mismo commit y alcance. Cuando una fuente no permite
> observar algo (red, API remota, fecha de rotación), el estado es
> `unknown`/`unverified`, no un veredicto inventado.

> **Nota de seguridad.** Cualquier credencial de ejemplo en estos documentos es
> un **placeholder sintético** (p. ej. `AKIA...EXAMPLE`, truncado). No
> corresponde a ninguna credencial real y no debe copiarse a un sistema real.

## Documentos relacionados

| Documento | Qué cubre |
| --- | --- |
| [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) | Runbooks de incidente, rotación, reescritura de historial y break-glass. |
| [`MIGRATION.md`](./MIGRATION.md) | Migración desde 0.1.0, instalaciones parciales y personalizadas; rollback. |
| [`COMPATIBILITY.md`](./COMPATIBILITY.md) | Plataformas, arquitecturas, POSIX, symlinks, worktrees, preflight, red/proxy/CA. |
| [`PROVIDERS.md`](./PROVIDERS.md) | Setup y límites de Claude, Kiro, Jira, GitHub y AWS CodeCommit. |
| [`RELEASE.md`](./RELEASE.md) | Canal oficial, integridad del tarball, versionado/procedencia reproducible. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Cambios con columnas de impacto, enforcement y migración. |
| [`../../../providers/github/LIMITATIONS.md`](../../../providers/github/LIMITATIONS.md) | Límites honestos del pack GitHub. |
| [`../../../providers/aws-codecommit/LIMITATIONS.md`](../../../providers/aws-codecommit/LIMITATIONS.md) | Límites honestos del pack AWS CodeCommit. |

## 1. Arquitectura: core, adaptadores y packs

Kiritek separa la seguridad en tres planos independientes que comparten un único
motor de políticas, un redactor obligatorio y schemas versionados. Ninguna capa
reimplementa la detección: todas invocan el core.

- **Core (`core/security`)** — se instala siempre, sin requerir stack. Aporta el
  motor de políticas (`src/policy/`), el runner de Gitleaks fijado por versión y
  checksum (`src/scanners/`), los cálculos de alcance Git staged/push
  (`src/git/`), los hooks versionados, el CI portable (`src/integrations/ci.js`),
  la auditoría por capacidades (`src/audit/`) y los runbooks de incidente
  (`src/incident/`). El core es el **único** lugar donde se decide allow/warn/deny.
- **Adaptadores** — conectan asistentes y servicios al core sin duplicar
  política. Hoy: **Claude Code** (`src/integrations/claude.js`, hooks
  `PreToolUse`), **Kiro** (`src/integrations/kiro.js`, hooks `PreToolUse`) y
  **Jira** (`src/integrations/jira.js`, validación remota de claves). Un
  adaptador traduce su evento al `PolicyInput` común y deja que el core decida.
- **Packs de providers (`providers/*`)** — opcionales e independientes:
  **GitHub** y **AWS CodeCommit**. Sólo **generan y validan planes/artefactos**
  (branch protection, rulesets, IAM, pipelines). **Nunca autoaplican
  infraestructura cloud:** todo es dry-run y cualquier mutación exige
  confirmación humana explícita fuera del plan.

```
                 ┌─────────────────────────────────────────┐
   Claude ─┐     │  Core: motor de políticas + redactor      │
   Kiro  ──┼────▶│  Gitleaks runner · scopes Git · hooks     │────▶ decisión
   Jira  ──┘     │  CI portable · auditoría · incidentes      │     allow/warn/deny
                 └─────────────────────────────────────────┘
   Packs GitHub / AWS CodeCommit → planes dry-run (invocan el core, no re-escanean)
```

## 2. Matriz de controles por etapa

Las fases del plan son **M** (MVP), **H** (endurecimiento) y **P** (providers).
La etapa de ejecución indica **dónde** actúa cada control. Los hooks de cliente
(**pre-commit/pre-push/commit-msg**) son locales y, por diseño, **evadibles**
(ver sección 7); el enforcement final vive en controles remotos (CI y
provider).

| Control | Etapa de ejecución | Comando / artefacto | Decisión posible |
| --- | --- | --- | --- |
| Secretos (Gitleaks) staged | pre-commit (local) | `scan --scope=staged` | allow / warn / deny |
| Secretos pre-push (rango) | pre-push (local) | `scan --scope=push` | allow / warn / deny |
| Secretos repo/historial | CI (remoto) | `scan --scope=repository\|history` | allow / warn / deny |
| Archivos sensibles (`.env`, `*.key`, PEM…) | pre-commit / adaptadores | motor `policy/files` | allow / warn / deny |
| Conventional Commits + sintaxis Jira | commit-msg (local) | `validate commit` | allow / warn / deny |
| Jira remoto (existencia de clave) | pre-push / CI | `validate push` | allow / warn / unverified |
| Guardas Git (push directo, force, `--no-verify`) | pre-push (local) + provider | motor `policy/git` | allow / warn / deny |
| Escritura/comando de asistente | `PreToolUse` (Claude/Kiro) | `validate claude-hook` / `validate kiro-hook` | allow / ask¹ / deny |
| Auditoría por capacidades | bajo demanda / CI | `security audit [--deep]` | ok / degraded / failed / unknown |
| Readiness y promoción a enforce | bajo demanda | `security doctor` / `security promote --to=enforce` | ready / not-ready / unknown |
| Plan de provider (dry-run) | bajo demanda | `provider plan github\|aws-codecommit` | plan descrito (sin mutar) |

¹ `ask` sólo existe en el contrato de Claude Code; Kiro decide por exit code
(sin modo `ask`). Ver [`PROVIDERS.md`](./PROVIDERS.md).

## 3. Defaults

Fuente de verdad: `src/config/defaults.js`. El baseline es **seguro pero no
destructivo**: modo `warning` para no romper repos existentes, con push directo
a la rama default bloqueado y `--force` denegado por defecto.

| Clave | Default | Nota |
| --- | --- | --- |
| `mode` | `warning` | Repos nuevos pueden recomendarse en enforcement; la promoción es gobernada. |
| `defaultBranch.explicit` | `null` | Nunca se asume `main`; se resuelve dinámicamente (ver §5). |
| `defaultBranch.remote` | `origin` | |
| `secrets.gitleaksVersion` | `8.18.4` | Versión exacta fijada con checksum por plataforma. |
| `secrets.historyDepth` | `full` | |
| `git.blockDirectDefaultPush` | `true` | |
| `git.forcePolicy` | `deny` | Alternativas: `lease-only`, `allow`. |
| `commits.enabled` | `true` | Validación **sintáctica** local; no prueba existencia remota. |
| `commits.maxSubjectLength` | `72` | |
| `jira.enabled` | `false` | |
| `jira.keyPattern` | `[A-Z][A-Z0-9]+-[0-9]+` | Configurable. |
| `jira.unavailable` | `fail-closed` | Alternativa: `warn` (emite `unverified`, nunca `verified`). |
| `jira.requireCredentials` | `false` | Credenciales sólo desde entorno/secret store. |
| `evidence.maxAgeHours` | `24` | Evidencia más vieja no sostiene `verified`. |
| `evidence.directory` | `.kiritek/security` | Se añade a Git y a indexadores IA por defecto. |
| `telemetry.enabled` | `false` | Envío remoto exige doble opt-in explícito. |

## 4. Flags del CLI

Fuente de verdad: `src/cli-parser.js` (`KNOWN_FLAGS`). Los flags booleanos
aceptan la forma negada `--no-<flag>`; los flags con valor aceptan `--k=v` o
`--k v`. Un flag desconocido se **rechaza** (no se ignora en silencio).

**Booleanos:** `--help`, `--version`, `--dry-run`, `--deep`, `--offline`,
`--yes`, `--non-interactive`.

**Con valor:** `--security`, `--mode`, `--gitleaks-version`, `--gitleaks-source`,
`--history-depth`, `--default-branch`, `--block-direct-push`, `--force-policy`,
`--commits`, `--jira`, `--jira-key-pattern`, `--message-file`, `--message`,
`--file`, `--branch`, `--jira-fallback`, `--jira-base-url`, `--event`, `--range`,
`--remote`, `--provider`, `--assistants`, `--hooks`, `--ci`, `--report-dir`,
`--telemetry`, `--format`, `--stack`, `--scope`, `--to`, `--webhook`,
`--override-actor`, `--override-reason`.

### Comandos de seguridad

| Comando | Qué hace |
| --- | --- |
| `scan --scope=staged\|push\|repository\|history` | Ejecuta el escaneo de secretos en el alcance indicado. |
| `validate commit` | Valida Conventional Commits + sintaxis Jira local (`--message-file` o `--message`). |
| `validate push` | Verifica remotamente las claves Jira del alcance del push. |
| `validate config` | Valida la configuración efectiva. |
| `validate claude-hook` | Evalúa un evento `PreToolUse` de Claude Code (stdin). |
| `validate kiro-hook` | Evalúa un evento `PreToolUse` de Kiro (stdin). |
| `security audit [--deep]` | Auditoría por capacidades; `--deep` corre el self-check sintético. |
| `security doctor` | Diagnóstico de readiness para promover a enforcement. |
| `security promote --to=enforce` | Promueve a enforcement si readiness lo permite (override gobernado). |
| `security exception validate [--file=<ruta>]` | Valida un archivo de excepciones bajo gobernanza. |
| `security install` | Instala/reconcilia el pack `core/security`. |
| `provider plan github\|aws-codecommit` | Genera un plan de provider dry-run (nunca aplica). |
| `uninstall --security` | Desinstalación selectiva del ownership Kiritek. |

Las credenciales (p. ej. Jira) se leen **sólo del entorno/secret store** y jamás
se imprimen. `stdout` es siempre JSON parseable; `stderr` lleva el diagnóstico
humano.

## 5. Precedencia de configuración

Fuente de verdad: `src/config/precedence.js`. De mayor a menor precedencia:

```
flags  >  variables KIRITEK_*  >  config de proyecto  >  defaults
```

Cada clave con flag tiene su variable `KIRITEK_*` equivalente (p. ej. `--mode` ↔
`KIRITEK_MODE`, `--jira-fallback` ↔ `KIRITEK_JIRA_FALLBACK`). El resolvedor
conserva el **origen efectivo** de cada valor (`flag`/`env`/`project`/`default`)
para poder explicar de dónde salió, sin imprimir secretos. La rama default no se
asume: se resuelve por precedencia **explícita > symbolic ref remoto > API del
provider > upstream verificable**, y en enforcement/no interactivo se exige
explícita si hay conflicto o ausencia.

## 6. Estados y exit codes

### Exit codes del CLI

| Código | Significado |
| --- | --- |
| `0` | OK / `allow` / `warn` / readiness `ready` / plan generado. |
| `1` | `deny` / `error` de política / readiness `not-ready` / entrada inválida de datos. |
| `2` | Error de configuración o uso (flag/scope/target inválido, confirmación requerida). |
| `3` | Estado **desconocido** que importa (auditoría/doctor): no verificable. |

### Hooks de asistentes

- **Claude Code (`validate claude-hook`):** decide por el bloque
  `hookSpecificOutput.permissionDecision` (`allow`/`deny`/`ask`). Además,
  **exit 2 bloquea como fail-safe** y cualquier error (stdin ilegible, JSON
  inválido, fallo de evaluación o de redacción) resulta en exit 2 — nunca en un
  permiso implícito.
- **Kiro (`validate kiro-hook`):** decide por **exit code**: `0` permite, `2`
  bloquea (único código de denegación válido). No existe modo `ask`. Toda ruta
  resuelve deliberadamente a 0 o 2.

### Estados de auditoría

`statusOf` (`src/audit/report.js`) clasifica cada capacidad como: `ok`,
`degraded`, `failed`, `drift`, `missing`, `unknown` o `not_applicable`. Una
herramienta corrupta o no disponible produce `failed`/`missing`, **nunca**
`clean`. Evidencia expirada o de otro commit degrada la capa (no sostiene
`verified`).

## 7. Límites honestos (léelos antes de confiar)

Estas son **declaraciones**, no acciones. Evitan una falsa sensación de
seguridad:

- **Los hooks de cliente son evadibles.** `pre-commit`, `pre-push` y `commit-msg`
  corren en la máquina del desarrollador y pueden saltarse (`--no-verify`,
  desinstalar el hook, editar `core.hooksPath`, etc.). Kiritek deniega
  `--no-verify` en sus adaptadores y modela el break-glass por separado, pero el
  **enforcement definitivo depende de controles remotos** (CI y provider). Los
  hooks locales son una **primera línea rápida**, no la última.
- **La protección sobre la rama default NO protege las feature branches.** IAM,
  rulesets o branch protection sobre `main`/default protegen esa rama, pero
  **no impiden que un secreto llegue a una feature branch**. Por eso el escaneo
  local, pre-push y CI siguen siendo obligatorios y complementarios (requisitos
  16.3, 19.3, 27.4, G.10). Ver también los `LIMITATIONS.md` de cada provider.
- **Borrar el último commit o reescribir el historial NO revoca una credencial.**
  Si un secreto se expuso, **debe rotarse/revocarse** con el proveedor.
- **Las capacidades cloud dependen del plan, la licencia y los permisos.** Un
  pack de provider puede describir un ruleset o una approval rule, pero su
  disponibilidad real depende de la cuenta/organización; Kiritek lo marca como
  dependiente de plan/permisos y declara el fallback.

### Kiritek NO bloquea por "autoría IA"

Kiritek **no** incluye —ni recomienda— detectores de autoría de IA como gate.
En **ningún** punto del flujo se bloquea un commit, push o PR por haber sido
"escrito por IA" o por puntajes de detección de autoría. Esa clase de detección
es poco fiable, discriminatoria y ajena al objetivo del framework. Los controles
de Kiritek evalúan **hechos verificables** (secretos, archivos sensibles, formato
de commit, existencia de clave Jira, guardas Git), nunca la procedencia humana o
automática del texto.

## 8. Evidencia

Toda salida persistente o pública cruza el **redactor obligatorio**
(`src/scanners/redactor.js`): se eliminan secretos, matches, líneas fuente,
prompts, payloads y headers; si un canario sobrevive, la publicación se
**bloquea** (fail-closed). La evidencia (`src/domain/evidence.js`) registra
comando, versión/hash de configuración, alcance, timestamp, exit code y decisión
—nunca el valor sensible— y vive bajo el directorio de reportes
(`evidence.directory`, por defecto `.kiritek/security`), añadido a Git e
indexadores IA. La evidencia caduca (`evidence.maxAgeHours`): una evidencia
vieja o de otro commit **no** sostiene un estado `verified`.

## 9. Ciclo de vida de la instalación

Ver también [`MIGRATION.md`](./MIGRATION.md) para el detalle de migración y
rollback. El instalador es transaccional: prevalida todo, escribe en temporales
y renombra atómicamente, y sólo persiste el inventario tras los self-checks.

- **Instalación nueva (repo nuevo).** Se instala el core en el inventario
  administrado (`.kiritek/inventory.json`). Un repo nuevo puede recomendarse en
  enforcement para secretos nuevos, bypasses y pushes peligrosos; la promoción
  real es gobernada (`security promote`).
- **Repo existente.** El core se instala en modo `warning` para no romper el
  trabajo en curso. Nada que ya exista se sobrescribe en silencio.
- **Update desde 0.1.0.** Se **adoptan** los artefactos legacy con su hash
  actual (no se marcan como drift), se instala el baseline en `warning` y se
  parchea el workflow inseguro (ver `MIGRATION.md`). Un artefacto personalizado
  nunca se sobrescribe: se deja una propuesta `*.kiritek-new`.
- **Rollback.** Cualquier fallo durante la instalación revierte los cambios y no
  persiste un inventario a medias; los archivos vuelven a su estado previo.
- **Uninstall.** `uninstall --security` desinstala **sólo** el ownership de
  Kiritek y restaura las integraciones preexistentes registradas; nunca toca
  archivos que no instaló.
- **Conflictos.** Un artefacto personalizado produce un conflicto explícito: no
  se sobrescribe y se deja una propuesta para resolución manual. Mientras exista
  un conflicto crítico sin resolver, el estado se declara **no conforme**
  (`compliant: false`); no se finge cumplimiento.

## 10. Runbooks operativos

El detalle vive en [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md). Resumen de
cuándo usar cada runbook:

- **Falso positivo** — abre una **excepción gobernada** (owner, razón,
  expiración) con `security exception validate`; nunca uses `--no-verify` ni
  allowlists globales.
- **Herramienta no disponible** — el control reporta `tool_unavailable`/`error`,
  nunca `clean`; corrige la integridad (versión/checksum) antes de promover.
- **Jira caído** — en fallback se marca `unverified`/`no_verificado_remotamente`,
  jamás `verified`; `fail-closed` deniega, `warn` advierte según modo.
- **Secreto detectado (local)** — clase `local-blocked`: elimina del código;
  rota si el valor pudo quedar comprometido.
- **Secreto publicado** — clase `published`: **revoca/rota primero**, luego
  evalúa uso, elimina del código y decide tratamiento del historial.
- **Rotación** — registra evidencia redactada; respeta los umbrales de edad
  (warn ≥ 80 días, fail ≥ 90 días cuando la fecha es observable; `unknown` si no).
- **Reescritura de historial** — sólo con el checklist **gated** completo
  (invalidación previa, coordinación, backup, verificación posterior).
- **Break-glass** — flujo separado con identidad autorizada, motivo,
  ticket/incidente, alcance, expiración y revisión posterior; nunca `--no-verify`.
