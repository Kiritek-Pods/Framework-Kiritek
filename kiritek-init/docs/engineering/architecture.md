# Arquitectura

## Límites con `core/security`

- Configuración propia (`kiritek-engineering.config.json`), niveles, promoción,
  auditoría, evidencia, telemetría y desinstalación **separados**. Engineering
  nunca lee ni escribe `kiritek-security.config.json`, y la auditoría de cada
  dominio no depende del otro: un dominio ausente es `absent`, no un fallo.
- No hay booleano global de "cumplimiento": el reporte multidominio conserva
  cada dominio por separado.
- Los adaptadores engineering son **warning-first**: un fallo propio (CLI
  ausente, evento ilegible, evaluación caída) permite con aviso. Security, en
  cambio, es fail-closed. Ambos coexisten en Kiro, Claude y Git sin pisarse.

## Pipeline de una evaluación

```text
config + catálogo (versión exacta, digest) + plugins fijados
  → unidades y perfiles explícitos → alcance por momento (staged, rango PR, artefacto)
  → N/A gobernado → presupuesto → collectors (proceso aislado, timeout)
  → normalización → aplicabilidad → evidencia (frescura, completitud)
  → evaluator puro (dos veces: debe ser determinista)
  → waivers → compuerta de confianza (mayDeny lo calcula SIEMPRE el core)
  → agregación → publicación (minimización → redacción → detector → schema)
```

`deny` sólo es elegible si **todo** se cumple: nivel `enforce`, momento incluido
en el contrato de enforcement, aplicabilidad determinista, evidencia
determinista, fresca y completa del mismo alcance/config/catálogo, finding
determinista no suprimido. Cualquier otro deny se degrada a `warn` (o `error`
si es operativo) con `DENY_NOT_ELIGIBLE` y queda un evento auditable.

## Decisiones y estados

| Decisión | Significa | ¿Bloquea? |
|---|---|---|
| `allow` | evaluado sin incumplimientos | no |
| `warn` | incumplimiento en `warn`, heurística, evidencia incompleta o deuda suprimida | no |
| `deny` | incumplimiento determinista elegible en `enforce` | sí (exit 1) |
| `error` | problema operativo (timeout, herramienta, conflicto) — nunca incumplimiento | no |

Estados del resultado: `evaluated`, `off`, `not_applicable`, `unavailable`,
`timeout`, `conflict`, `stale`, `unknown`, `not_evaluated`.

## Estados de auditoría

`guardrails audit` da una fila por **unidad × control × momento**:

| Estado | Significa |
|---|---|
| `absent` | pack sin configurar |
| `off` | nivel off — nunca equivale a conforme |
| `suggested` | el perfil requerido sólo lo sugiere discovery (aceptarlo es explícito) |
| `not_applicable` | faltan perfiles requeridos, o N/A gobernado |
| `unavailable` | implementación no enlazada o última ejecución indisponible |
| `unknown` | sin ejecución registrada para ese momento |
| `stale` | evidencia de otra revisión o vencida |
| `conflict` | evidencia no reproducible (flaky) |
| `drift` | config/catálogo/versión cambiados o artefactos/superficies alterados |
| `verified` | ejecución de la revisión actual, misma config y catálogo, evidencia presente, superficie intacta |

Las superficies se verifican por conexión real (no por presencia de archivos).
CI y release remotos nunca son `verified` por un YAML local: como mucho `unknown`.

## Momentos

| Momento | Alcance | Presupuesto | Qué corre |
|---|---|---|---|
| agent | ruta propuesta | 1.5 s | contratos/manifests; tests conductuales diferidos |
| pre-commit | índice staged exacto | 5 s | igual que agent, offline |
| pr | rango base..head completo | 10 min | contratos + harness conductuales |
| release | artefacto/config candidata + unidad | 15 min | igual que PR, evidencia fresca |

## Privacidad

Todo lo publicado (reportes, evidencia, registro de ejecuciones, telemetría)
pasa por minimización por schema, campos prohibidos, saneo de rutas/URLs,
detector final y validación de schema. Si algo se escapa, no se publica
(`REDACTION_FAILED`). Los harness usan datos sintéticos.
