"use strict";

/** Collector de `flags.lifecycle` (T21). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadFlagRegistry } = require("./contract.js");
const { harnessParams } = require("./scenarios.js");

const FLAG_RE = /(\bisEnabled\(|\buseFlag\(|\buseFeature(?:Flag|IsOn|Value)?\(|\bvariation\(|\bgetFeatureValue\(|\bisFeatureEnabled\(|\bgetBooleanValue\(|launchdarkly|growthbook|unleash|openfeature)/i;

module.exports = makeCollector({
  id: "flags-lifecycle/collector",
  version: "1.0.0",
  label: "feature flags",
  paramName: "flagRegistry",
  contractKind: "flags-registry",
  behaviorKind: "flags-behavior",
  runKind: "flags-harness-run",
  signalsKind: "flags-signals",
  traceSchema: "engineering/controls/flags-lifecycle.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createFlagClientUnderTest",
  load: loadFlagRegistry,
  harnessParams: (facts) => harnessParams(facts),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: FLAG_RE, signal: "FEATURE_FLAG_USE" }),
});
