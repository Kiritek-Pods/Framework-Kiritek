# Gate de release

El pack no se declara disponible porque existan archivos o pasen los tests
locales. El gate (`scripts/release-gate.js`, T17) junta evidencia de toda la
matriz y decide `ready` o `blocked`. Mientras esté `blocked` el pack sigue
**warning-only** (R27.7): ningún control builtin puede bloquear, porque el
catálogo con `enforce` (2.0.0) no se publica y `approved.json` queda vacío.

## Qué exige

| Criterio | Qué demuestra |
|---|---|
| T17.1 | instalación idempotente y separación de security |
| T17.2 | resolución reproducible de perfiles, unidades, catálogo y config; monorepo |
| T17.3 | los tres controles detectan sus fallos por comportamiento; suites R27 en verde |
| T17.4 | ninguna ruta heurística u operativa llega a `deny`; el candidato sin aprobación no carga |
| T17.5 | auditoría honesta, vigencia de evidencia, waivers/N-A y rollback |
| T17.6 | privacidad, supply chain, compatibilidad, documentación; matriz completa; Actions por SHA |
| T17.7 | candidato reproducible, semver y migración, notas, suite completa del repo en verde, árbol limpio |

Cada archivo de test engineering está asignado a un criterio; un test nuevo
sin asignar bloquea el gate. La matriz requerida es la de
[compatibility.md](compatibility.md): Linux y macOS con Node 22 (suite
completa), Linux con Node 18 y 20 y Windows con Node 22 (suite engineering).

## Cómo correrlo

1. Commitear: el gate rechaza evidencia de un árbol con cambios.
2. Dejar que corra el workflow `kiritek-init-ci`. Cada job sube su resultado
   (`kiritek-test-job-*.json`) y el job `release-gate` evalúa con todos.
3. Localmente, con los artefactos descargados:

   ```sh
   node scripts/release-gate.js --jobs ./artefactos
   ```

   Exit 0 = `ready`, 3 = `blocked`. La evidencia queda en
   `release/evidence/latest.gate.json` con cada brecha y su dueño.
4. Con `ready`, publicar:

   ```sh
   node scripts/release-gate.js --approve --evidence release/evidence/latest.gate.json
   ```

   Sólo acepta evidencia `ready` de la revisión actual y con el candidato y
   las suites sin cambios. Escribe `approved.json` (cada suite fijada por
   digest), copia el catálogo a `catalogs/engineering/guardrails/2.0.0`, fija
   la plantilla de config en 2.0.0 y deja la procedencia en
   `release/provenance/`. Commitear ese cambio como release.

Si después se modifica una suite R27 (casos o adapters de referencia), su
digest deja de coincidir y la suite pierde la aprobación hasta un gate nuevo.
