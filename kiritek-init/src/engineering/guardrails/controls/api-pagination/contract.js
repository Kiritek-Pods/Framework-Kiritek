"use strict";

/** Contrato de paginación de API (T35.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-pagination.contract";

const factsOf = (doc) => ({
  collections: doc.collections
    .map((c) => ({ id: c.id, path: c.path, mode: c.mode, defaultPageSize: c.defaultPageSize, maxPageSize: c.maxPageSize, itemsField: c.itemsField || "items", cursorField: c.cursorField || "nextCursor", limitParam: c.limitParam || "limit", cursorParam: c.cursorParam || "cursor", offsetParam: c.offsetParam || "offset" }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadPaginationContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.collections, (c) => c.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadPaginationContract, factsOf };
