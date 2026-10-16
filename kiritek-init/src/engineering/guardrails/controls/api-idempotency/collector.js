"use strict";

/** Collector de `api.idempotency` (T32). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadIdempotencyContract } = require("./contract.js");

const SIGNAL_RE = /(\.post\(|\.put\(|\.patch\(|@PostMapping|@PutMapping|router\.(?:post|put|patch)|app\.(?:post|put|patch)\(|@app\.(?:post|put|patch))/;

module.exports = makeCollector({
  id: "api-idempotency/collector",
  version: "1.0.0",
  label: "idempotencia",
  paramName: "idempotencyContract",
  contractKind: "idempotency-contract",
  behaviorKind: "idempotency-behavior",
  runKind: "idempotency-harness-run",
  signalsKind: "idempotency-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadIdempotencyContract,
  harnessParams: (facts) => ({ endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "MUTATING_ENDPOINT" }),
});
