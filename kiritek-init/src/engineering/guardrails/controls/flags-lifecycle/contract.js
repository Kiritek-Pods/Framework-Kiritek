"use strict";

/** Registro de feature flags (T21.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/flags-lifecycle.contract";

function factsOf(doc) {
  return {
    flags: doc.flags
      .map((f) => ({ key: f.key, owner: f.owner, kind: f.kind, createdAt: f.createdAt, removeBy: f.removeBy || null, defaultValue: f.defaultValue, killSwitch: !!f.killSwitch }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    client: doc.client ? { timeoutMs: doc.client.timeoutMs, refreshSeconds: doc.client.refreshSeconds } : null,
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadFlagRegistry(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { prefix: "REGISTRY", uniqueIds: (d) => unique(d.flags, (f) => f.key) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadFlagRegistry, factsOf };
