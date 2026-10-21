"use strict";

/** Contrato de límites de uso (T34.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-rate-limit.contract";

const factsOf = (doc) => ({
  limits: doc.limits.map((l) => ({ id: l.id, method: l.method, path: l.path, limit: l.limit, windowSeconds: l.windowSeconds, by: l.by })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadRateLimitContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.limits, (l) => l.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadRateLimitContract, factsOf };
