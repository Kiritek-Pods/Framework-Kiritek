"use strict";

/** Contrato de logs (T38.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/svc-log-hygiene.contract";

const factsOf = (doc) => ({
  correlationHeader: doc.correlationHeader,
  fields: { level: doc.fields.level, message: doc.fields.message, requestId: doc.fields.requestId },
  endpoints: doc.endpoints.map((e) => ({ id: e.id, method: e.method, path: e.path, sampleBody: e.sampleBody || null })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadLogsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadLogsContract, factsOf };
