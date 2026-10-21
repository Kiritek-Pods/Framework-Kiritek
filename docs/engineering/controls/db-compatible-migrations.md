# `db.compatible-migrations`

Verifica que las migraciones nuevas **no rompan al código que sigue corriendo
durante el deploy**, cuando la versión vieja y la nueva conviven sobre la
misma base: nada de borrar o renombrar columnas o tablas en uso, cambiar
tipos, agregar `NOT NULL` sin `DEFAULT` ni (en Postgres) crear índices que
bloqueen escrituras. Las contracciones se permiten si su expansión ya está
desplegada (patrón **expand/contract**). Perfil requerido: `backend-service`.
Disponible desde el catálogo 2.0.0, en `warn` por defecto.

## Declaración del equipo

`parameters.migrationsContract` → JSON (schema `db-compatible-migrations.contract`):

```json
{
  "schemaVersion": 1,
  "control": "db.compatible-migrations",
  "dialect": "postgres",
  "baseline": "002_orders",
  "contractPhase": [{ "migration": "005_drop_legacy_name", "expandedBy": "002_orders" }],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/migrations.adapter.js" }
}
```

- `dialect`: `postgres`, `mysql`, `sqlite` o `generic`.
- `baseline`: id de la última migración **ya desplegada**. Sólo se revisan
  las posteriores; sin `baseline` se revisan todas.
- `contractPhase`: contracciones intencionales con la migración que las
  expandió. Están exentas sólo si esa expansión es el baseline o anterior.

Las tablas creadas después del baseline todavía no están en producción, así
que cambiarlas no rompe a nadie y no se cuentan.

## Adapter

`createMigrationsUnderTest({ clock, deps })` → `{ migrations() → [{ id, sql }] }`,
en orden de aplicación. El SQL puede leerse de los archivos o generarse con la
herramienta del equipo (Prisma, Knex, Flyway, Alembic…). La traza sólo lleva
conteos por clase de cambio.

## Matriz

| Escenario | Qué se espera | Reglas |
|---|---|---|
| scan | migraciones legibles, baseline presente y cero cambios incompatibles | `migrations-unreadable`, `drop-column`, `rename`, `drop-table`, `type-change`, `not-null-without-default`, `blocking-index` |
| exceptions (si hay `contractPhase`) | cada contracción con expansión ya desplegada | `contract-without-expand` |

Remediaciones: [remediation.md](../remediation.md#dbcompatible-migrations-catálogo-200).
