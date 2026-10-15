"use strict";

/** Contrato de estados de pantalla (T18.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/ui-data-states.contract";

function factsOf(doc) {
  return {
    screens: doc.screens.map((s) => ({ id: s.id, timeoutMs: s.timeoutMs, emptyState: s.emptyState, retry: s.retry })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadStatesContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.screens, (s) => s.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadStatesContract, factsOf };
