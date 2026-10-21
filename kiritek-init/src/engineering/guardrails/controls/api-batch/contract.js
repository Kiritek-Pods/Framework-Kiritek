"use strict";

/** Contrato de operaciones en lote (T45.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-batch.contract";

const factsOf = (doc) => ({
  endpoints: doc.endpoints
    .map((e) => ({ id: e.id, method: e.method || "POST", path: e.path, mode: e.mode, maxItems: e.maxItems, itemsField: e.itemsField || "items", resultsField: e.resultsField || "results", refField: e.refField || "ref", sampleItem: e.sampleItem, invalidItem: e.invalidItem }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadBatchContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadBatchContract, factsOf };
