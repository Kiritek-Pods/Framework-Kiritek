"use strict";

/** Collector de `db.compatible-migrations` (T46). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadMigrationsContract } = require("./contract.js");

const SIGNAL_RE = /(ALTER TABLE|DROP COLUMN|knex\.schema|queryInterface\.|migrations?\/|flyway|liquibase|alembic)/i;

module.exports = makeCollector({
  id: "db-compatible-migrations/collector",
  version: "1.0.0",
  label: "migraciones compatibles",
  paramName: "migrationsContract",
  contractKind: "migrations-contract",
  behaviorKind: "migrations-behavior",
  runKind: "migrations-harness-run",
  signalsKind: "migrations-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createMigrationsUnderTest",
  load: loadMigrationsContract,
  harnessParams: (facts) => ({ dialect: facts.dialect, baseline: facts.baseline, exceptions: facts.exceptions }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "MIGRATIONS" }),
});
