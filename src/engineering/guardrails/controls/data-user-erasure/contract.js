"use strict";

/** Contrato de borrado de datos del usuario (T47.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/data-user-erasure.contract";

const factsOf = (doc) => ({
  erasure: { method: doc.erasure.method, path: doc.erasure.path },
  stores: doc.stores.map((s) => ({ id: s.id })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  reads: (doc.readEndpoints || []).map((r) => ({ id: r.id, path: r.path })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadErasureContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.stores, (s) => s.id) && unique(d.readEndpoints, (r) => r.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadErasureContract, factsOf };
