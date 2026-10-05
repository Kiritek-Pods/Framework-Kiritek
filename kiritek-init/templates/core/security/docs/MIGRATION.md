# Migración a seguridad integral (desde 0.1.0, parcial y personalizada)

Esta guía describe cómo `kiritek-init` migra una instalación previa — una
instalación 0.1.0 "limpia", una **parcial** (interrumpida a medias) o una
**personalizada** (con hooks, config o docs editados por ti) — al modelo de
seguridad integral con inventario administrado, sin pisar tu trabajo.

La migración está implementada en `src/install/migrate.js` y **reutiliza** el
reconciliador transaccional, el inventario, la fusión administrada y el motor
de transacciones. No reimplementa ninguno de ellos.

## Principios

1. **Nunca sobrescribe tu trabajo.** Un artefacto que personalizaste jamás se
   reemplaza en silencio. Como mucho se deja una propuesta `*.kiritek-new` al
   lado del original para que decidas tú.
2. **Honestidad por defecto.** Mientras exista un conflicto **crítico** sin
   resolver, la migración se declara **no conforme** (`compliant: false`) y
   lista los bloqueos. No se finge cumplimiento.
3. **Transaccional.** Cualquier fallo durante la instalación del baseline
   revierte los cambios (rollback) y no persiste un inventario a medias.
4. **Reentrante.** Correr la migración dos veces produce el mismo resultado:
   no duplica entradas de inventario ni vuelve a proponer lo ya adoptado.
5. **Offline.** No requiere red: todo el baseline vive en los templates locales
   y la cache direccionada por versión/checksum.

## Qué hace la migración, paso a paso

### 1. Detección y adopción (preservación)

Una instalación 0.1.0 no tiene `.kiritek/inventory.json`. La migración detecta
los artefactos legacy conocidos y los **adopta** en el inventario con su hash
**actual**:

| Artefacto legacy             | Estrategia de adopción |
| ---------------------------- | ---------------------- |
| `kiritek-audit.config.json`  | `owned`                |
| `CLAUDE.md`                  | `generated`            |
| `AGENTS.md`                  | `generated`            |
| `.graphifyignore`            | `managed-block`        |

Adoptar con el hash actual significa que **no se te marca como "drift"** por
algo que Kiritek nunca registró. A partir de ese momento sí se detectan tus
cambios futuros. Tus hooks, tu config y tus docs personalizados se preservan
tal cual: la adopción no muta ningún archivo.

### 2. Baseline en modo `warning`

Se instala el pack `core/security` en modo **`warning`** para no romper un repo
existente. La promoción a `enforce` es un paso posterior y **gobernado**
(`security promote`, ver `security doctor`), no ocurre durante la migración.

El baseline se instala vía el reconciliador transaccional:

- Un artefacto que **no** personalizaste se crea o se actualiza.
- Un artefacto que **sí** personalizaste produce un **conflicto**: no se
  sobrescribe; se deja una propuesta `*.kiritek-new` al lado para resolución
  explícita.

### 3. Corrección del workflow inseguro (parche crítico)

El workflow semanal de 0.1.0 hacía **commit/push directo** del reporte, lo que
viola la protección de rama y puede filtrar contenido. La migración lo trata
como **parche crítico**:

- **No lo personalizaste** → se reemplaza por el workflow endurecido mediante un
  _replace seguro_ y transaccional (permisos mínimos, sin push/commit, actions
  fijadas por SHA inmutable, timeout y concurrency, subida como artefacto).
- **Lo personalizaste** → **no se sobrescribe**. Se deja la versión endurecida
  como propuesta `.github/workflows/kiritek-audit.yml.kiritek-new` para que
  compares lado a lado y resuelvas. El conflicto queda **abierto**.

### 4. Reconciliación de stacks, Jira, asistentes y providers

La migración deja el baseline del core listo sobre el inventario compartido.
Los packs de stacks, el validador de Jira, los adaptadores de asistentes y los
providers se reconcilian con sus propios instaladores sobre el **mismo**
inventario; la migración no los reimplementa, sólo prepara el terreno y señala
la continuación.

## Gate de conformidad (crítico)

Mientras exista un **conflicto crítico** sin resolver —típicamente el workflow
inseguro personalizado que sigue empujando— la migración devuelve:

```json
{ "compliant": false, "compliantBlockers": ["workflow de auditoría inseguro ... sin resolver"] }
```

No puedes obtener un veredicto conforme hasta resolver ese conflicto (adoptar la
propuesta `.kiritek-new` o endurecer tu workflow a mano). Esto es deliberado:
preferimos decir la verdad a declarar un cumplimiento falso.

## Fallo parcial, rollback y reanudación

- Si una instalación 0.1.0 quedó **a medias** (parcial), la migración retoma
  desde el estado real del disco: adopta lo que exista y completa el baseline.
- Si ocurre un fallo durante la instalación del baseline, la transacción hace
  **rollback** completo: los archivos vuelven a su estado previo y el inventario
  **no** se persiste a medias. Puedes volver a ejecutar la migración (es
  reentrante) una vez corregida la causa.

## Offline / cache

La migración **no abre red**. El baseline proviene de los templates locales y la
cache de herramientas direccionada por versión/checksum. Puedes migrar en un
entorno sin salida a Internet; la verificación remota (p. ej. Jira) es un paso
posterior y opcional según tu configuración y modo.

## Privacidad

Todo resumen de migración y toda evidencia emitida cruzan el **redactor
obligatorio**: no se emiten secretos, contenido de tus archivos ni líneas
fuente. Los fixtures de prueba son sintéticos y no contienen secretos reales.

## Uso

```bash
# Vista previa sin mutar nada (plan/diff):
kiritek-init migrate --dry-run

# Ejecutar la migración (baseline en warning, parche de workflow, adopción):
kiritek-init migrate
```

Tras migrar, revisa cualquier archivo `*.kiritek-new` dejado como propuesta y, si
corresponde, procede a `security doctor` y `security promote` para pasar a
enforcement de forma gobernada.
