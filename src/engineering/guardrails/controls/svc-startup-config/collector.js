"use strict";

/** Collector de `svc.startup-config` (T49). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadStartupConfigContract } = require("./contract.js");

const SIGNAL_RE = /(process\.env\.|os\.environ|getenv\(|System\.getenv|envalid|dotenv|@Value\("\$\{)/;

module.exports = makeCollector({
  id: "svc-startup-config/collector",
  version: "1.0.0",
  label: "configuración al arrancar",
  paramName: "startupConfigContract",
  contractKind: "config-contract",
  behaviorKind: "config-behavior",
  runKind: "config-harness-run",
  signalsKind: "config-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "startService",
  load: loadStartupConfigContract,
  harnessParams: (facts) => ({ variables: facts.variables.slice(0, 30) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "ENV_CONFIG" }),
});
