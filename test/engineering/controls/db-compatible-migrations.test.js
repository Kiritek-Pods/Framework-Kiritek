"use strict";

// T46: `db.compatible-migrations` — sin cambios que rompan al código desplegado (expand/contract).

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/db-compatible-migrations/contract.js");
const { statements, classify, analyze } = require("../../../src/engineering/guardrails/controls/db-compatible-migrations/sql.js");

const SPEC = { slug: "db-compatible-migrations", factory: "createMigrationsUnderTest", contractKind: "migrations-contract", behaviorKind: "migrations-behavior", fixtures: "migrations", param: "migrationsContract", harnessParams: (f) => ({ dialect: f.dialect, baseline: f.baseline, exceptions: f.exceptions }) };
const facts = (extra = {}) => factsOf({ dialect: "postgres", baseline: "002_orders", harness: { kind: "node-adapter", adapter: "x" }, ...extra });
const FACTS = facts();

test("T46.2 las migraciones compatibles pasan y la traza sólo lleva conteos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  assert.ok(!/users|orders|ALTER/i.test(JSON.stringify(trace.scenarios)));
});

test("T46.2 clasificador: formas incompatibles por dialecto", () => {
  const k = (sql, d = "postgres") => statements(sql).flatMap((s) => classify(s, d));
  assert.deepEqual(k("ALTER TABLE t DROP COLUMN a"), ["dropColumn"]);
  assert.deepEqual(k("ALTER TABLE t DROP a", "mysql"), ["dropColumn"]);
  assert.deepEqual(k("ALTER TABLE t ALTER COLUMN a DROP NOT NULL, DROP CONSTRAINT c"), []);
  assert.deepEqual(k("ALTER TABLE t CHANGE a b int", "mysql"), ["rename"]);
  assert.deepEqual(k("ALTER TABLE t MODIFY a bigint", "mysql"), ["typeChange"]);
  assert.deepEqual(k("ALTER TABLE t ADD COLUMN a int NOT NULL DEFAULT 0, ADD COLUMN b int NOT NULL"), ["notNull"]);
  assert.deepEqual(k("ALTER TABLE t ALTER COLUMN a SET NOT NULL"), ["notNull"]);
  assert.deepEqual(k("CREATE UNIQUE INDEX i ON t (a)"), ["blockingIndex"]);
  assert.deepEqual(k("CREATE INDEX CONCURRENTLY i ON t (a)"), []);
  assert.deepEqual(k("CREATE INDEX i ON t (a)", "sqlite"), []);
  assert.deepEqual(k("-- DROP TABLE t\nINSERT INTO log VALUES ('DROP TABLE t')"), []);
});

test("T46.2 baseline: sólo se revisan migraciones nuevas y las tablas nuevas están exentas", () => {
  const ms = [{ id: "a", sql: "DROP TABLE viejo" }, { id: "b", sql: "CREATE TABLE n (id int); ALTER TABLE n DROP COLUMN id" }];
  assert.equal(analyze(ms, { baseline: "a" }).counts.dropTable, 0);
  assert.equal(analyze(ms, { baseline: "a" }).counts.dropColumn, 0);
  assert.equal(analyze(ms, {}).counts.dropTable, 1);
  assert.equal(analyze(ms, { baseline: "zz" }).baselineFound, false);
});

test("T46.3 contracción declarada: exenta sólo si su expansión ya está desplegada", async () => {
  const ok = await runControl(SPEC, "drop-column", facts({ contractPhase: [{ migration: "005_dropColumn", expandedBy: "002_orders" }] }));
  assert.equal(ok.result.decision, "allow", JSON.stringify(ok.result));
  const early = await runControl(SPEC, "drop-column", facts({ contractPhase: [{ migration: "005_dropColumn", expandedBy: "003_status" }] }));
  assert.deepEqual(early.rules, ["contract-without-expand", "drop-column"]);
});

const MATRIX = {
  "drop-column": ["drop-column"],
  "rename-column": ["rename"],
  "drop-table": ["drop-table"],
  "type-change": ["type-change"],
  "not-null": ["not-null-without-default"],
  "blocking-index": ["blocking-index"],
  unreadable: ["migrations-unreadable"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T46.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
