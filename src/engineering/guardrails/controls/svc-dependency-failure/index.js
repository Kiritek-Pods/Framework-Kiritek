"use strict";

/** Implementación de `svc.dependency-failure` (T36). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["deps-contract", "deps-behavior", "deps-signals", "deps-harness-run"], behaviorKind: "deps-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("deps-contract", "DEPENDENCY_CONTRACT_MISSING", "perfil backend-service sin contrato de dependencias"),
  evaluator: require("./evaluator.js"),
};
