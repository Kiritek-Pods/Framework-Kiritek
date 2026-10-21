"use strict";

/** Casos de conformidad R27 de `db.compatible-migrations` (T46.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "db.compatible-migrations", dialect: "postgres", baseline: "002_orders", harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/migrations.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { migrationsContract: "apps/x/migrations.json" } });
const negative = (id, adapter, rules, mutate) => ({ id, kind: "negative", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "warn", rules, eligible: true } });
const positive = (id, adapter, mutate) => ({ id, kind: "positive", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "allow", rules: [], eligible: false } });

module.exports = {
  control: "db.compatible-migrations",
  profiles: ["backend-service"],
  cases: [
    positive("migraciones-compatibles", "good"),
    positive("contraccion-con-expansion-desplegada", "drop-column", (d) => (d.contractPhase = [{ migration: "005_dropColumn", expandedBy: "002_orders" }])),
    positive("destructivo-solo-en-comentarios", "comment-only"),
    positive("mysql-sin-concurrently", "blocking-index", (d) => (d.dialect = "mysql")),
    negative("borra-columna", "drop-column", ["drop-column"]),
    negative("renombra-columna", "rename-column", ["rename"]),
    negative("borra-tabla", "drop-table", ["drop-table"]),
    negative("cambia-tipo", "type-change", ["type-change"]),
    negative("not-null-sin-default", "not-null", ["not-null-without-default"]),
    negative("indice-bloqueante", "blocking-index", ["blocking-index"]),
    negative("contraccion-sin-expansion-desplegada", "drop-column", ["contract-without-expand", "drop-column"], (d) => (d.contractPhase = [{ migration: "005_dropColumn", expandedBy: "003_status" }])),
    negative("baseline-inexistente", "good", ["migrations-unreadable"], (d) => (d.baseline = "999_no_existe")),
    negative("migraciones-sin-sql", "unreadable", ["migrations-unreadable"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/migrations/003.sql": "ALTER TABLE users DROP COLUMN legacy_name;\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
