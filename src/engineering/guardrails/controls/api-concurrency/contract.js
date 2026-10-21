"use strict";

/** Contrato de edición concurrente (T39.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-concurrency.contract";

const factsOf = (doc) => ({
  resources: doc.resources
    .map((r) => ({ id: r.id, path: r.path, method: r.method || "PATCH", mode: r.mode, versionField: r.versionField || "version", field: r.field || "name", requirePrecondition: r.requirePrecondition !== false }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadConcurrencyContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.resources, (r) => r.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadConcurrencyContract, factsOf };
