"use strict";

/** Contrato de migraciones compatibles (T46.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/db-compatible-migrations.contract";

const factsOf = (doc) => ({
  dialect: doc.dialect,
  baseline: doc.baseline || null,
  exceptions: (doc.contractPhase || []).map((x) => ({ migration: x.migration, expandedBy: x.expandedBy })).sort((a, b) => (a.migration < b.migration ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadMigrationsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.contractPhase, (x) => x.migration) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadMigrationsContract, factsOf };
