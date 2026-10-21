"use strict";

/** Contrato de listas paginadas (T24.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/ui-pagination.contract";

function factsOf(doc) {
  return {
    lists: doc.lists.map((l) => ({ id: l.id, pageSize: l.pageSize, mode: l.mode, endState: l.endState })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadListsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.lists, (l) => l.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadListsContract, factsOf };
