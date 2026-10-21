"use strict";

/** Contrato de diálogos (T31.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/ui-accessible-dialogs.contract";

const factsOf = (doc) => ({
  dialogs: doc.dialogs.map((d) => ({ id: d.id, kind: d.kind, dismissible: d.dismissible })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadDialogsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.dialogs, (x) => x.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadDialogsContract, factsOf };
