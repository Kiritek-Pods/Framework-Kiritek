"use strict";

/** Implementación de `api.request-limits` (T41). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["limits-contract", "limits-behavior", "limits-signals", "limits-harness-run"], behaviorKind: "limits-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("limits-contract", "LIMITS_CONTRACT_MISSING", "perfil http-api sin contrato de límites de request"),
  evaluator: require("./evaluator.js"),
};
