"use strict";

/** Contrato de permisos (T29.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/app-device-permissions.contract";

const factsOf = (doc) => ({
  permissions: doc.permissions.map((p) => ({ id: p.id, kind: p.kind, fallback: p.fallback })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadPermissionsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.permissions, (p) => p.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadPermissionsContract, factsOf };
