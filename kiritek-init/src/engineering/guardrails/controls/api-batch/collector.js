"use strict";

/** Collector de `api.batch` (T45). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadBatchContract } = require("./contract.js");

const SIGNAL_RE = /(\/batch\b|bulk|insertMany\(|bulkWrite\(|createMany\(|saveAll\(|\b207\b)/;

module.exports = makeCollector({
  id: "api-batch/collector",
  version: "1.0.0",
  label: "operaciones en lote",
  paramName: "batchContract",
  contractKind: "batch-contract",
  behaviorKind: "batch-behavior",
  runKind: "batch-harness-run",
  signalsKind: "batch-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadBatchContract,
  harnessParams: (facts) => ({ endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "BATCH_ENDPOINT" }),
});
