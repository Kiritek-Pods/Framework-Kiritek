# Adaptadores y providers — setup y límites honestos

Esta guía documenta cómo configurar y qué **no** garantizan los adaptadores de
asistentes (Claude Code, Kiro), la validación de Jira y los packs de providers
cloud (GitHub, AWS CodeCommit). Es parte del hub [`SECURITY.md`](./SECURITY.md).

> **Dos límites se repiten en todos los adaptadores de cliente:**
>
> 1. **Los hooks de cliente son evadibles.** Corren en la máquina del
>    desarrollador y pueden saltarse. El enforcement definitivo vive en CI y en
>    el provider.
> 2. **La protección sobre la rama default NO protege las feature branches.**
>    IAM/rulesets sobre `main`/default acotan esa rama, pero no impiden que un
>    secreto llegue a una feature branch (requisitos 16.3, 19.3, 27.4, G.10).

> **Kiritek NO bloquea por "autoría IA".** Ningún adaptador aquí descrito usa un
> detector de autoría de IA como gate ni bloquea por procedencia IA del texto.
> Ver [`SECURITY.md`](./SECURITY.md) §7.

## 1. Claude Code (hooks `PreToolUse`)

**Qué hace.** El adaptador (`src/integrations/claude.js`, plantillas en
`../adapters/claude/`) genera hooks `PreToolUse` con matchers de escritura
(`Edit|Write`) y de comando (`Bash`) que invocan el CLI core y traducen el
evento al `PolicyInput` común. El core decide; el adaptador no reimplementa
política.

**Setup.**

- Instala los hooks del adaptador en `.claude/` (ver `../adapters/claude/README.md`).
- El hook invoca `kiritek-init validate claude-hook` leyendo el evento por stdin.
- `askOnMediumRisk` (config de asistentes) permite devolver `ask` en riesgo medio.

**Contrato de decisión.** La salida es el bloque
`hookSpecificOutput.permissionDecision` (`allow`/`deny`/`ask`). Además,
**exit 2 bloquea como fail-safe** y Claude lo respeta por encima de un `allow`.
Precedencia multi-hook: `deny > ask > allow`.

**Límites.**

- Es un hook de **cliente**: evadible (ver nota superior).
- Cualquier error (stdin ilegible, JSON inválido, fallo de evaluación o de
  redacción) resulta en **bloqueo** (exit 2), nunca en permiso implícito.
- Nunca se registran prompts, código ni valores de `tool_input`.

## 2. Kiro (hooks `PreToolUse`)

**Qué hace.** El adaptador (`src/integrations/kiro.js`, plantillas en
`../adapters/kiro/`) genera hooks `PreToolUse` para Kiro e invoca
`kiritek-init validate kiro-hook` por stdin.

**Setup.** Instala los hooks del adaptador por workspace (ver
`../adapters/kiro/README.md`). El matcher es un regex contra el nombre de la
tool (`Edit|Write`, `Bash`, etc.).

**Contrato de decisión.** Kiro decide por **exit code**, no por un bloque
`permissionDecision`: `0` permite, `2` bloquea (único código de denegación
válido). **No existe modo `ask`** en Kiro. Un código distinto de 0/2 Kiro lo
trata como fallo de hook no bloqueante; por eso el adaptador resuelve siempre a
0 o 2.

**Límites.** Igual que Claude: hook de cliente evadible; cualquier error resulta
en bloqueo (exit 2); nunca se registran prompts/código/valores de `tool_input`.

## 3. Jira (validación remota de claves)

**Qué hace.** El adaptador (`src/integrations/jira.js`) verifica la **existencia
remota** de las claves Jira del alcance del push, compartiendo el extractor de
claves con pre-push y CI (misma clave validada en ambos lados).

**Setup.**

- `jira.enabled=true` y `jira.baseUrl` para identificar el tenant (la base URL
  **no** contiene credenciales).
- Credenciales **sólo** desde el entorno/secret store; nunca en la config ni en
  el output.
- Parámetros: `jira.keyPattern`, `jira.timeoutMs`, `jira.rateLimitPerMinute`,
  `jira.cacheTtlSeconds`, `jira.requireCredentials`, `jira.unavailable`.

**Estados.** `exists`/`accessible`, `policy-invalid`, `not-found`, `401`, `429`,
`timeout`. Una negativa **deniega**; la indisponibilidad aplica `fail-closed`
(deniega) o `warn` (advierte) según el modo.

**Límites.**

- En fallback `warn` el resultado es `unverified`/`no_verificado_remotamente`,
  **nunca** `verified`.
- Si las credenciales son obligatorias y faltan, falla sin imprimir el valor.
- La validación local de `validate commit` es **sintáctica**: comprueba el
  formato de la clave, no su existencia remota.
- `NO-JIRA` es una **excepción gobernada** (limitada por tipo de cambio y con
  razón), no un bypass universal.

## 4. GitHub (pack de provider)

**Qué hace.** El pack (`src/providers`, plantillas en `../../../providers/github/`)
**describe** branch protection, rulesets, CODEOWNERS y un workflow de CI
endurecido. Genera un **plan dry-run**; **no aplica** nada.

**Setup.**

- `provider plan github` genera el plan (determinista, schema-válido).
- El workflow del pack (`workflows/kiritek-security.yml`) usa permisos mínimos
  (`contents: read`), actions fijadas por **SHA inmutable de 40 hex**,
  `concurrency`, `timeout`, `persist-credentials: false`, maneja forks con el
  disparador `pull_request` no privilegiado e **invoca el comando core**
  (`kiritek-init scan`) en vez de reimplementar la detección.
- Reemplaza `@your-org/security-team` en `CODEOWNERS` por los propietarios
  reales; CODEOWNERS por sí solo no obliga revisión: requiere un ruleset/branch
  protection que exija "require review from Code Owners".

**Límites.** Ver [`../../../providers/github/LIMITATIONS.md`](../../../providers/github/LIMITATIONS.md).
Resumen: capacidades dependen del plan/permisos de la organización; la
protección de la rama default no protege feature branches; el plan es dry-run y
cualquier aplicación requiere confirmación humana explícita.

## 5. AWS CodeCommit (pack de provider)

**Qué hace.** El pack (`src/providers/codecommit.js`, plantillas en
`../../../providers/aws-codecommit/`) **describe** IAM de mínimo privilegio,
approval rule templates, pipeline (CodePipeline/CodeBuild) y alertas
(SNS/EventBridge). Genera un **plan dry-run**; **no aplica** nada cloud.

**Setup.**

- `provider plan aws-codecommit` genera el plan (determinista, schema-válido).
- El pipeline del pack **invoca el comando core** (`kiritek-init scan`) para
  conservar la red de seguridad en la nube sin reimplementar detección.

**Límites.** Ver [`../../../providers/aws-codecommit/LIMITATIONS.md`](../../../providers/aws-codecommit/LIMITATIONS.md).
Resumen: la protección IAM/approval sobre la rama default no protege feature
branches; CodeCommit no excluye nativamente al autor del conteo de aprobaciones
(se refuerza con pool por rol IAM distinto); prefiere credenciales temporales
(STS); el plan es dry-run y cualquier aplicación requiere confirmación humana
explícita.
