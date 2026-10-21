"use strict";

/** Contrato de modo sin conexión (T28.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/app-offline-mode.contract";

const factsOf = (doc) => ({
  indicator: doc.indicator,
  actions: doc.actions.map((a) => ({ id: a.id, queue: a.queue })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadOfflineContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.actions, (a) => a.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadOfflineContract, factsOf };
