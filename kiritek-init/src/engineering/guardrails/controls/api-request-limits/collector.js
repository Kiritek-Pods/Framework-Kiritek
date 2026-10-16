"use strict";

/** Collector de `api.request-limits` (T41). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadLimitsContract } = require("./contract.js");

const SIGNAL_RE = /(bodyParser|express\.json\(|bodyLimit|max_body_size|client_max_body_size|requestTimeout|AbortSignal\.timeout|server\.timeout|readTimeout)/;

module.exports = makeCollector({
  id: "api-request-limits/collector",
  version: "1.0.0",
  label: "límites de request",
  paramName: "limitsContract",
  contractKind: "limits-contract",
  behaviorKind: "limits-behavior",
  runKind: "limits-harness-run",
  signalsKind: "limits-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadLimitsContract,
  harnessParams: (facts) => ({ maxBodyBytes: facts.maxBodyBytes, timeoutMs: facts.timeoutMs, endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "REQUEST_LIMITS" }),
});
