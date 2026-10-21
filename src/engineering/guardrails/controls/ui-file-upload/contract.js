"use strict";

/** Contrato de subidas (T23.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/ui-file-upload.contract";

function factsOf(doc) {
  return {
    uploads: doc.uploads.map((u) => ({ id: u.id, maxBytes: u.maxBytes, accept: [...u.accept].sort(), cancel: u.cancel, retry: u.retry })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadUploadsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.uploads, (u) => u.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadUploadsContract, factsOf };
