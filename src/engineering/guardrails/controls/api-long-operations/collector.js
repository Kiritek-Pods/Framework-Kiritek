"use strict";

/** Collector de `api.long-operations` (T44). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadLongOperationsContract } = require("./contract.js");

const SIGNAL_RE = /(status\(202\)|\b202\b|HttpStatus\.ACCEPTED|\.enqueue\(|\/operations\/|\/jobs\/|jobId|operationId)/;

module.exports = makeCollector({
  id: "api-long-operations/collector",
  version: "1.0.0",
  label: "operaciones largas",
  paramName: "operationsContract",
  contractKind: "longops-contract",
  behaviorKind: "longops-behavior",
  runKind: "longops-harness-run",
  signalsKind: "longops-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadLongOperationsContract,
  harnessParams: (facts) => ({ operations: facts.operations.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "ASYNC_OPERATION" }),
});
