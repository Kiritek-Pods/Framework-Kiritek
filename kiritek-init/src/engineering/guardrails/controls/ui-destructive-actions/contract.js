"use strict";

/** Contrato de acciones destructivas (T26.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/ui-destructive-actions.contract";

function factsOf(doc) {
  return {
    actions: doc.actions.map((a) => ({ id: a.id, safeguard: a.safeguard, ...(a.undoWindowMs !== undefined ? { undoWindowMs: a.undoWindowMs } : {}) })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadActionsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.actions, (a) => a.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadActionsContract, factsOf };
