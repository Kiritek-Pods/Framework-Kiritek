"use strict";

/** Contrato de idempotencia (T32.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-idempotency.contract";

const factsOf = (doc) => ({
  endpoints: doc.endpoints.map((e) => ({ id: e.id, method: e.method, path: e.path, keyHeader: e.keyHeader, requireKey: e.requireKey, sampleBody: e.sampleBody })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadIdempotencyContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadIdempotencyContract, factsOf };
