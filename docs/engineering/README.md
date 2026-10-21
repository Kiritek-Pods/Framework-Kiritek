# Kiritek `engineering/guardrails` — documentación

Pack de guardrails de ingeniería **independiente de `core/security`**. Verifica
prácticas de producto (búsqueda, versión mínima móvil, anuncio de módulos web)
con evidencia, empezando siempre en `warn`. Sólo un incumplimiento
**determinista, aplicable, vigente y reproducible**, en un control promovido a
`enforce` con suite de conformidad aprobada, puede bloquear. Las heurísticas
nunca bloquean.

| Documento | Para qué |
|---|---|
| [architecture.md](architecture.md) | Cómo funciona: pipeline, límites con security, decisiones y estados de auditoría |
| [configuration.md](configuration.md) | `kiritek-engineering.config.json`, catálogo, perfiles, controles, momentos, waivers/N-A, telemetría, plugins |
| [guides.md](guides.md) | Repo nuevo/existente, monorepo, offline, CI, agentes, rollout, rollback, update y uninstall |
| [runbooks.md](runbooks.md) | Qué hacer ante falso positivo, flaky test, herramienta no disponible, evidencia stale/conflicto, waiver/N-A, hard update defectuoso y anuncio inaccesible |
| [remediation.md](remediation.md) | Catálogo de remediaciones por regla, con ejemplos neutrales al framework |
| [compatibility.md](compatibility.md) | Matriz de plataformas, Node, Git, agentes, CI, red y offline |
| [release.md](release.md) | Gate de release: criterios, matriz requerida, evidencia y aprobación |
| [CHANGELOG.md](CHANGELOG.md) | Versiones del pack y del catálogo |
| [controls/](controls/) | Referencia de cada control: contrato, harness, matriz de comportamiento y casos límite |

Referencia rápida de la CLI (`kiritek-init guardrails <comando>`):

```text
install [--surfaces=kiro,claude,git,ci] [--dry-run]   instalar y enlazar superficies
update [--to=<catálogo>] [--dry-run]                   actualizar sin promover gates
migrate [--dry-run]                                    adoptar instalaciones previas
scan --moment=agent|pre-commit|pr|release ...          evaluar
audit [--deep] [--format=text]                         capacidades reales
doctor / promote --unit --control --to=enforce|warn    readiness y promoción por par (--actor)
conformance [--control]                                suites R27 de los controles
feedback --control --rule --fingerprint --verdict      calidad (falsos positivos)
telemetry status|flush                                 telemetría opt-in
uninstall [--purge-evidence]                           retirar sólo lo engineering
```
