"use strict";

/** Implementación de `api.versioning` (T40). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["versioning-contract", "versioning-behavior", "versioning-signals", "versioning-harness-run"], behaviorKind: "versioning-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("versioning-contract", "VERSIONING_CONTRACT_MISSING", "perfil http-api sin contrato de versionado"),
  evaluator: require("./evaluator.js"),
};
