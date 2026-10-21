"use strict";

/** Implementación de `data.user-erasure` (T47). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["erasure-contract", "erasure-behavior", "erasure-signals", "erasure-harness-run"], behaviorKind: "erasure-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("erasure-contract", "ERASURE_CONTRACT_MISSING", "perfil backend-service sin contrato de borrado de datos"),
  evaluator: require("./evaluator.js"),
};
