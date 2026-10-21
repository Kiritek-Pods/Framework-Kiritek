"use strict";

/** Implementación de `svc.metrics` (T48). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["metrics-contract", "metrics-behavior", "metrics-signals", "metrics-harness-run"], behaviorKind: "metrics-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("metrics-contract", "METRICS_CONTRACT_MISSING", "perfil backend-service sin contrato de métricas"),
  evaluator: require("./evaluator.js"),
};
