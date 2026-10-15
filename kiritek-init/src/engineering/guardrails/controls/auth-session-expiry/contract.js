"use strict";

/** Contrato de sesión (T22.1): forma + hechos mínimos. */

const { loadContractFile } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/auth-session-expiry.contract";

const factsOf = (doc) => ({ session: { refresh: doc.session.refresh, preserveWork: doc.session.preserveWork }, hasHarness: !!doc.harness, harnessKind: doc.harness ? doc.harness.kind : null });

function loadSessionContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA);
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadSessionContract, factsOf };
