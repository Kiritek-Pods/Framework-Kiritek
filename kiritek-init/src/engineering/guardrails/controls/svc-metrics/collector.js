"use strict";

/** Collector de `svc.metrics` (T48). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadMetricsContract } = require("./contract.js");

const SIGNAL_RE = /(prom-client|prometheus|micrometer|opentelemetry|@opentelemetry|new Histogram|new Counter|\/metrics)/i;

module.exports = makeCollector({
  id: "svc-metrics/collector",
  version: "1.0.0",
  label: "métricas del servicio",
  paramName: "metricsContract",
  contractKind: "metrics-contract",
  behaviorKind: "metrics-behavior",
  runKind: "metrics-harness-run",
  signalsKind: "metrics-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createServiceUnderTest",
  load: loadMetricsContract,
  harnessParams: (facts) => ({ metricsPath: facts.metricsPath, names: facts.names, labels: facts.labels, endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "METRICS" }),
});
