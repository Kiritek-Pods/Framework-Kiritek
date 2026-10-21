"use strict";

/** Contrato de versionado de API (T40.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-versioning.contract";

const factsOf = (doc) => ({
  scheme: doc.scheme,
  header: doc.header || "api-version",
  versions: doc.versions
    .map((v) => ({ id: v.id, status: v.status, sunset: v.sunset || null, requiredFields: [...(v.requiredFields || [])].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  endpoints: doc.endpoints.map((e) => ({ id: e.id, path: e.path })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadVersioningContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.versions, (v) => v.id) && unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadVersioningContract, factsOf };
