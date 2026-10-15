"use strict";

/** Implementación de `analytics.events` (T25). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["analytics-plan", "analytics-behavior", "analytics-signals", "analytics-harness-run"], behaviorKind: "analytics-behavior", traceSchema: "engineering/controls/analytics-events.trace" }),
  applicability: contractApplicability("analytics-plan", "TRACKING_PLAN_MISSING", "perfil analytics sin plan de tracking"),
  evaluator: require("./evaluator.js"),
};
