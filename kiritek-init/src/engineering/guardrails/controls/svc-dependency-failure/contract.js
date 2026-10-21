"use strict";

/** Contrato de dependencias (T36.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/svc-dependency-failure.contract";

const factsOf = (doc) => ({
  endpoint: { method: doc.endpoint.method, path: doc.endpoint.path, sampleBody: doc.endpoint.sampleBody || null },
  dependencies: doc.dependencies.map((d) => ({ id: d.id, kind: d.kind, timeoutMs: d.timeoutMs, circuitBreaker: d.circuitBreaker, degraded: d.degraded })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadDependencyContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.dependencies, (x) => x.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadDependencyContract, factsOf };
