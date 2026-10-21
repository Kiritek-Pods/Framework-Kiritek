"use strict";

/** Contrato de límites de request (T41.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-request-limits.contract";

const factsOf = (doc) => ({
  maxBodyBytes: doc.maxBodyBytes,
  timeoutMs: doc.timeoutMs,
  endpoints: doc.endpoints.map((e) => ({ id: e.id, method: e.method, path: e.path, sampleBody: e.sampleBody || null })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadLimitsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadLimitsContract, factsOf };
