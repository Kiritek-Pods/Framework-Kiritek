"use strict";

/** Collector de `analytics.events` (T25). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadTrackingPlan } = require("./contract.js");
const { MAX_EVENTS } = require("./scenarios.js");

const TRACK_RE = /(\btrack\(|\blogEvent\(|\bcapture\(|analytics\.|gtag\(|dataLayer\.push|mixpanel|amplitude|segment|posthog)/i;

module.exports = makeCollector({
  id: "analytics-events/collector",
  version: "1.0.0",
  label: "analytics",
  paramName: "trackingPlan",
  contractKind: "analytics-plan",
  behaviorKind: "analytics-behavior",
  runKind: "analytics-harness-run",
  signalsKind: "analytics-signals",
  traceSchema: "engineering/controls/analytics-events.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createTrackerUnderTest",
  load: loadTrackingPlan,
  harnessParams: (facts) => ({ events: facts.events.slice(0, MAX_EVENTS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: TRACK_RE, signal: "ANALYTICS_CALL" }),
});
