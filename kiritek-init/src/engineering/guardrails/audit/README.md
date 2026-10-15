# Auditoría engineering por capacidades (T15)

`kiritek-init guardrails audit [--unit] [--control] [--deep] [--format=json|text]`

Una fila por **unidad × control × momento del catálogo** (no se inventan filas
para momentos que el control no soporta). Cada capa se verifica por separado:
instalación e integridad del pack (inventario; la config editada no cuenta),
configuración, nivel, perfiles (explícito / heredado / sugerido por discovery),
linkage real collector/evaluator ↔ catálogo, superficie del momento, última
ejecución, frescura, drift y evidencia.

| Estado | Significa |
|---|---|
| `absent` | pack sin configurar (no es fallo; security no se ve afectado) |
| `off` | nivel off — nunca equivale a conforme |
| `suggested` | el perfil requerido sólo lo sugiere discovery |
| `not_applicable` | perfiles ausentes o N/A en la última ejecución |
| `unavailable` | implementación no enlazada o última ejecución indisponible/timeout |
| `unknown` | sin ejecución registrada, o evidencia referida ausente |
| `stale` | ejecución de otra revisión, vieja o con evidencia vencida |
| `conflict` | evidencia no reproducible |
| `drift` | config/catálogo/versión distintos, artefactos o superficie alterados |
| `verified` | ejecución de la revisión actual, misma config/catálogo, evidencia presente y superficie intacta |

- **Fuente de `lastRun`**: `scan` escribe la evidencia y un registro por
  momento (`<evidence>/runs/<momento>.json`, schema `run-ledger`). La
  comparación de config es por par unidad/control (flags como `--offline` no
  son drift).
- **Superficies** (`surfaces.js`): Kiro, Claude y Git se verifican contra las
  plantillas (alterado ⇒ `drift`, sin `+x` ⇒ `not-executable`, sin hook/entrada
  que lo invoque ⇒ `disconnected`). CI y release remotos nunca son
  `verified` por un YAML local: máximo `unknown`.
- **`--deep`** agrega self-checks sintéticos (`self-check.js`): por control, un
  fallo determinista fabricado debe ser elegible para bloquear y una señal
  heurística nunca (un deny heurístico se rechaza); más un canario de
  redacción.
- **Multidominio** (`report.js#multiDomainReport`): cada dominio por separado,
  `absent` si falta, sin booleano global.

## doctor / promote (T15.4)

`doctor [--unit --control]` evalúa readiness por par; `promote --unit --control
--to=enforce|warn [--dry-run]` cambia SÓLO ese par en la config. Bloquean:
catálogo/config, soporte de enforce, contrato de enforcement con suite R27
aprobada, aplicabilidad, linkage, self-checks, superficie (CI para PR; hook/
adaptador para agent/pre-commit), evidencia `verified` determinista y completa
en cada momento de enforcement, presupuesto, waivers/N-A inválidos y calidad
(falsos positivos o errores sobre el umbral, con ≥ 5 findings revisados).
Documentación y CODEOWNERS son advertencias. El tiempo transcurrido no promueve.
Volver a `warn` siempre está permitido y conserva parámetros y evidencia.
