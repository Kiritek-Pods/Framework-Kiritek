"use strict";

/** Implementación de `api.long-operations` (T44). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["longops-contract", "longops-behavior", "longops-signals", "longops-harness-run"], behaviorKind: "longops-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("longops-contract", "OPERATIONS_CONTRACT_MISSING", "perfil http-api sin contrato de operaciones largas"),
  evaluator: require("./evaluator.js"),
};
