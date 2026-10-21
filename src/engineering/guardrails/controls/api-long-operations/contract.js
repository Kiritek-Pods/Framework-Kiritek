"use strict";

/** Contrato de operaciones largas (T44.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-long-operations.contract";

const factsOf = (doc) => ({
  operations: doc.operations
    .map((o) => ({ id: o.id, method: o.method || "POST", path: o.path, sampleBody: o.sampleBody || null, statusPath: o.statusPath, statusField: o.statusField || "status", done: o.doneValue || "succeeded", failed: o.failedValue || "failed", maxDurationMs: o.maxDurationMs }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadLongOperationsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.operations, (o) => o.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadLongOperationsContract, factsOf };
