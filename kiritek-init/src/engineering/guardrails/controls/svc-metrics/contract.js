"use strict";

/** Contrato de métricas del servicio (T48.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/svc-metrics.contract";

const factsOf = (doc) => ({
  metricsPath: doc.metricsPath || "/metrics",
  names: { requests: doc.names.requests, duration: doc.names.duration },
  labels: { route: (doc.labels || {}).route || "route", method: (doc.labels || {}).method || "method", status: (doc.labels || {}).status || "status" },
  endpoints: doc.endpoints.map((e) => ({ id: e.id, method: e.method, route: e.route })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadMetricsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.endpoints, (e) => e.id) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadMetricsContract, factsOf };
