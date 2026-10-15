"use strict";

/** Contrato de llamadas de red (T20.1): forma + hechos mínimos (sin URLs). */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/net-resilient-requests.contract";

function factsOf(doc) {
  return {
    operations: doc.operations
      .map((o) => ({
        id: o.id,
        idempotent: o.idempotent,
        timeoutMs: o.timeoutMs,
        idempotencyKey: o.idempotencyKey,
        retry: { maxAttempts: o.retry.maxAttempts, backoff: o.retry.backoff, baseMs: o.retry.baseMs, ...(o.retry.maxDelayMs !== undefined ? { maxDelayMs: o.retry.maxDelayMs } : {}), on: [...o.retry.on].sort() },
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadClientContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.operations, (o) => o.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadClientContract, factsOf };
