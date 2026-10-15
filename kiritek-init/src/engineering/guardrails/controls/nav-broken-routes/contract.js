"use strict";

/** Contrato de rutas (T30.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/nav-broken-routes.contract";

const factsOf = (doc) => ({
  routes: doc.routes.map((r) => ({ path: r.path, auth: r.auth })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  deepLinks: doc.deepLinks,
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadRoutesContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.routes, (x) => x.path) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadRoutesContract, factsOf };
