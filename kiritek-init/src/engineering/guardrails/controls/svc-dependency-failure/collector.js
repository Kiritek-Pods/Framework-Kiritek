"use strict";

/** Collector de `svc.dependency-failure` (T36). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadDependencyContract } = require("./contract.js");

const SIGNAL_RE = /(new Pool\(|createClient\(|mongoose\.connect|new PrismaClient|axios\.create|new Redis\(|DataSource\b|sql\.Open\(|HttpClient\.newHttpClient)/;

module.exports = makeCollector({
  id: "svc-dependency-failure/collector",
  version: "1.0.0",
  label: "dependencias",
  paramName: "dependencyContract",
  contractKind: "deps-contract",
  behaviorKind: "deps-behavior",
  runKind: "deps-harness-run",
  signalsKind: "deps-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createServiceUnderTest",
  load: loadDependencyContract,
  harnessParams: (facts) => ({ endpoint: facts.endpoint, dependencies: facts.dependencies.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "EXTERNAL_DEPENDENCY" }),
});
