"use strict";

// Adapter de referencia de db.compatible-migrations (drop-column): borra una columna en uso
// Migraciones Postgres en orden; 001–002 ya desplegadas (baseline 002_orders).
const OPTS = {"dropColumn":true};
const BASE = [
  { id: "001_init", sql: "CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL, legacy_name text);" },
  { id: "002_orders", sql: "CREATE TABLE orders (id uuid PRIMARY KEY, user_id uuid NOT NULL);\nALTER TABLE users ADD COLUMN full_name text; -- expansión: reemplaza a legacy_name" },
];
const GOOD = [
  { id: "003_status", sql: "ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'pending';\nCREATE INDEX CONCURRENTLY orders_status_idx ON orders (status);" },
  { id: "004_invoices", sql: "/* tabla nueva: sus índices y cambios no afectan al código desplegado */\nCREATE TABLE invoices (id uuid PRIMARY KEY, order_id uuid NOT NULL);\nCREATE INDEX invoices_order_idx ON invoices (order_id);\nALTER TABLE invoices ADD COLUMN total integer NOT NULL;" },
];
const BAD = {
  dropColumn: "ALTER TABLE users DROP COLUMN legacy_name;",
  rename: "ALTER TABLE orders RENAME COLUMN user_id TO customer_id;",
  dropTable: "DROP TABLE orders;",
  typeChange: "ALTER TABLE orders ALTER COLUMN user_id TYPE bigint USING 0;",
  notNull: "ALTER TABLE users ADD COLUMN phone text NOT NULL;",
  blockingIndex: "CREATE INDEX users_email_idx ON users (email);",
  commentOnly: "-- ALTER TABLE users DROP COLUMN legacy_name;\nSELECT 'DROP TABLE orders';",
};

exports.createMigrationsUnderTest = () => {
  
  return {
    async migrations() {
      if (OPTS.unreadable) return [{ id: "001_init" }];
      const extra = Object.keys(BAD).filter((k) => OPTS[k]).map((k, i) => ({ id: `${String(5 + i).padStart(3, "0")}_${k}`, sql: BAD[k] }));
      return [...BASE, ...GOOD, ...extra];
    },
  };
};
