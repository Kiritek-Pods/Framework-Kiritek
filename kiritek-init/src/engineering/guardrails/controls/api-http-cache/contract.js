"use strict";

/** Contrato de caché HTTP (T42.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-http-cache.contract";

const factsOf = (doc) => ({
  resources: doc.resources
    .map((r) => ({ id: r.id, path: r.path, visibility: r.visibility, maxAgeSeconds: r.maxAgeSeconds === undefined ? null : r.maxAgeSeconds, validator: r.validator || "etag" }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadCacheContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.resources, (r) => r.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadCacheContract, factsOf };
