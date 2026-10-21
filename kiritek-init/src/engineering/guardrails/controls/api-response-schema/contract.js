"use strict";

/** Contrato de schemas de respuesta (T43.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/api-response-schema.contract";

// Los schemas viajan como texto JSON: sus nombres de propiedad (p. ej. `code`)
// no deben confundirse con campos de la evidencia.
const factsOf = (doc) => ({
  errorSchema: doc.errorSchema ? JSON.stringify(doc.errorSchema) : null,
  endpoints: doc.endpoints
    .map((e) => ({ id: e.id, method: e.method, path: e.path, status: e.status || (e.method === "POST" ? 201 : 200), sampleBody: e.sampleBody || null, invalidBody: e.invalidBody || null, responseSchema: JSON.stringify(e.responseSchema) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadResponseSchemaContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadResponseSchemaContract, factsOf };
