"use strict";

/** Contrato de configuración al arrancar (T49.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/svc-startup-config.contract";

const factsOf = (doc) => ({
  variables: doc.variables
    .map((v) => ({ name: v.name, required: v.required !== false, kind: v.kind, values: v.values || null, example: v.example || null }))
    .sort((a, b) => (a.name < b.name ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadStartupConfigContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.variables, (v) => v.name) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadStartupConfigContract, factsOf };
