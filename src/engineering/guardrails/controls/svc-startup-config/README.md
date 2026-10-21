# Control `svc.startup-config`

Implementación del control (catálogo 2.0.0). Comportamiento, contrato,
adapter y matriz de escenarios: `docs/engineering/controls/svc-startup-config.md`.

| Archivo | Rol |
|---|---|
| `contract.js` | lee y valida el contrato del equipo; extrae hechos mínimos |
| `scenarios.js` | escenarios, expectativas por escenario y regla de cada hecho |
| `harness.js` | harness conductual con reloj virtual (corre en un proceso hijo) |
| `collector.js` | observa (contrato, señales heurísticas, dos corridas del harness) |
| `evaluator.js` | decide (puro); remediaciones por regla |
| `index.js` | registro del control |

Las piezas comunes viven en `../shared/` (`behavior-collector.js`,
`behavior-evaluator.js`, `contract-file.js`, `harness-runner.js`, `http.js`).
La traza usa el schema común `facts.trace` (sólo booleanos y enteros).
