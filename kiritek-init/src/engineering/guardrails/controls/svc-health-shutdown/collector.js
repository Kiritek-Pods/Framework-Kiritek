"use strict";

/** Collector de `svc.health-shutdown` (T37). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadHealthContract } = require("./contract.js");

const SIGNAL_RE = /(\.listen\(|process\.on\(["']SIGTERM|createServer\(|uvicorn\.run|@SpringBootApplication|ListenAndServe\(|\/health|\/ready)/;

module.exports = makeCollector({
  id: "svc-health-shutdown/collector",
  version: "1.0.0",
  label: "salud y apagado",
  paramName: "healthContract",
  contractKind: "health-contract",
  behaviorKind: "health-behavior",
  runKind: "health-harness-run",
  signalsKind: "health-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createServiceUnderTest",
  load: loadHealthContract,
  harnessParams: (facts) => ({ livenessPath: facts.livenessPath, readinessPath: facts.readinessPath, dependencies: facts.dependencies, work: facts.work, shutdownGraceMs: facts.shutdownGraceMs }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "SERVICE_ENTRYPOINT" }),
});
