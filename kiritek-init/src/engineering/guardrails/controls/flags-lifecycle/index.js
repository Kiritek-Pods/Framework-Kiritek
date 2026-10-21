"use strict";

/** Implementación de `flags.lifecycle` (T21). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["flags-registry", "flags-behavior", "flags-signals", "flags-harness-run"], behaviorKind: "flags-behavior", traceSchema: "engineering/controls/flags-lifecycle.trace" }),
  applicability: contractApplicability("flags-registry", "FLAG_REGISTRY_MISSING", "perfil feature-flags sin registro de flags"),
  evaluator: require("./evaluator.js"),
};
