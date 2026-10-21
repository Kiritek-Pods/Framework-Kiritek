"use strict";

/** Collector de `api.concurrency` (T39). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadConcurrencyContract } = require("./contract.js");

const SIGNAL_RE = /(\.update\(|\.save\(|UPDATE \w+ SET|\.findOneAndUpdate\(|\.patch\(|router\.put\(|app\.put\(|@PutMapping|@PatchMapping)/;

module.exports = makeCollector({
  id: "api-concurrency/collector",
  version: "1.0.0",
  label: "edición concurrente",
  paramName: "concurrencyContract",
  contractKind: "concurrency-contract",
  behaviorKind: "concurrency-behavior",
  runKind: "concurrency-harness-run",
  signalsKind: "concurrency-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadConcurrencyContract,
  harnessParams: (facts) => ({ resources: facts.resources.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "UPDATE_ENDPOINT" }),
});
