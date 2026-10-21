"use strict";

/** Collector de `svc.log-hygiene` (T38). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadLogsContract } = require("./contract.js");

const SIGNAL_RE = /(console\.(?:log|info|error)\(|logger\.(?:info|error|warn|debug)\(|pino\(|winston\.|log\.(?:Printf|Println)|logging\.(?:info|error)|Log\.(?:i|e|d)\(|LoggerFactory)/;

module.exports = makeCollector({
  id: "svc-log-hygiene/collector",
  version: "1.0.0",
  label: "logs",
  paramName: "logsContract",
  contractKind: "logs-contract",
  behaviorKind: "logs-behavior",
  runKind: "logs-harness-run",
  signalsKind: "logs-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createServiceUnderTest",
  load: loadLogsContract,
  harnessParams: (facts) => ({ correlationHeader: facts.correlationHeader, fields: facts.fields, endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "LOGGING" }),
});
