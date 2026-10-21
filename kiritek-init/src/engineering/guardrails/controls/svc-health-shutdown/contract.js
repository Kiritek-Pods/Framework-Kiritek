"use strict";

/** Contrato de salud y apagado (T37.1): forma + hechos mínimos. */

const { loadContractFile } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/svc-health-shutdown.contract";

const factsOf = (doc) => ({
  livenessPath: doc.livenessPath,
  readinessPath: doc.readinessPath,
  dependencies: [...doc.dependencies].sort(),
  work: { method: doc.work.method, path: doc.work.path },
  shutdownGraceMs: doc.shutdownGraceMs,
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadHealthContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA);
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadHealthContract, factsOf };
