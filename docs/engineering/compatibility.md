# Compatibilidad

Fuente de verdad: `src/engineering/guardrails/compatibility.js` (la auditoría la
usa para no atribuir cobertura inexistente).

| Dimensión | Soporte |
|---|---|
| Node | ≥ 18 para el motor; **≥ 22 para ejecutar plugins** (modelo de permisos con lectura acotada; en versiones anteriores un plugin queda `unavailable`, nunca sin aislamiento) |
| macOS / Linux | completo |
| Windows | subconjunto: `scan`, `audit`, CI y CLI; los shims de hooks Git/Kiro/Claude son `sh` POSIX y no se instalan (la auditoría reporta esas superficies `unavailable`, cobertura en CI) |
| Arquitecturas | x64, arm64 |
| Git | ≥ 2.30; worktrees (hooks en el directorio común vía `git rev-parse --git-path hooks`); shallow ⇒ `SCOPE_RANGE_INCOMPLETE` (operativo, nunca deny) |
| Kiro | hooks v1 `PreToolUse` (exit 0 permite, 2 bloquea) |
| Claude Code | `PreToolUse` con `hookSpecificOutput.permissionDecision` |
| CI | plantilla GitHub Actions; cualquier otro proveedor vía CLI + JSON |
| Red | `HTTPS_PROXY`/`NO_PROXY` sólo para collectors con permiso de red; CA corporativa vía `NODE_EXTRA_CA_CERTS`; la validación TLS nunca se desactiva |
| Offline | sólo catálogo, plugins y evidencia verificados localmente |
| Texto y rutas | LF y CRLF en config/manifests; UTF-8; rutas con espacios y Unicode sin construir shell |

Supply chain de la plantilla de CI: Actions fijadas por SHA (con la versión en
comentario) y `kiritek-init` en versión exacta instalada localmente (sin `-g`).
