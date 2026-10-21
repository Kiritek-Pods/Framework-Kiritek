"use strict";

/** Contrato de errores de API (T33.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-error-responses.contract";

const factsOf = (doc) => ({
  errorFormat: doc.errorFormat,
  errorFields: doc.errorFields ? [...doc.errorFields] : [],
  endpoints: doc.endpoints.map((e) => ({ id: e.id, method: e.method, path: e.path, sampleBody: e.sampleBody, invalidBodies: e.invalidBodies })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadErrorsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadErrorsContract, factsOf };
