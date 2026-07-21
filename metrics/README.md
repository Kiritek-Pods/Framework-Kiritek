# Métricas de adopción — setup

Reporta % de adopción real por repo (conventional commits + checklist de cumplimiento) a un Google Sheet central. Cada repo se auto-reporta — no requiere acceso de infra a otros repos.

## 1. Crear el receptor (una sola vez, para todo Kiritek)

1. Google Sheet nuevo.
2. Extensiones → Apps Script → pegar [`apps-script-webhook.gs`](./apps-script-webhook.gs).
3. Desplegar → Nueva implementación → Aplicación web → copiar la URL.

## 2. Activar en cada repo de POD

1. Copiar [`kiritek-audit.yml`](./kiritek-audit.yml) a `.github/workflows/kiritek-audit.yml` del repo.
2. En el repo → Settings → Secrets and variables → Actions → agregar `KIRITEK_METRICS_WEBHOOK` con la URL del paso anterior.
3. Listo — corre solo, semanal. Se puede disparar manual desde la pestaña Actions ("Run workflow").

## Qué mide hoy

- `compliant`: si el repo tiene el mínimo Kiritek instalado (skills core, agentes, docs).
- `conventionalCommitRate`: % de los últimos 200 commits que siguen Conventional Commits — proxy de que el equipo *usa* `git-workflow`, no solo que está instalado.

## Qué NO mide (todavía)

- Tasa de vulnerabilidades — pendiente del scanner de seguridad (fuera de alcance de `kiritek-init`).
- Costo en tokens/licencias — vive en la consola de Anthropic, no en el repo.
- TTM completo — solo tendríamos la parte ticket→merge si se integra con la API de GitHub PRs; no construido aún.
