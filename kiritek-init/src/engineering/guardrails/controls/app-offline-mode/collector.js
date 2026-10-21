"use strict";

/** Collector de `app.offline-mode` (T28). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadOfflineContract } = require("./contract.js");

const OFFLINE_RE = /(navigator\.onLine|serviceWorker\.register|addEventListener\(["'](?:online|offline)["']|NetInfo\b|ConnectivityManager\b|NWPathMonitor\b|workbox|BackgroundSync)/;

module.exports = makeCollector({
  id: "app-offline-mode/collector",
  version: "1.0.0",
  label: "modo sin conexión",
  paramName: "offlineContract",
  contractKind: "offline-contract",
  behaviorKind: "offline-behavior",
  runKind: "offline-harness-run",
  signalsKind: "offline-signals",
  traceSchema: "engineering/controls/app-offline-mode.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createOfflineAppUnderTest",
  load: loadOfflineContract,
  harnessParams: (facts) => ({ indicator: facts.indicator, actions: facts.actions }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: OFFLINE_RE, signal: "OFFLINE_SUPPORT" }),
});
