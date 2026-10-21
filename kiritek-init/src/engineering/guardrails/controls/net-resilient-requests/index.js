"use strict";

/** Implementación de `net.resilient-requests` (T20). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["requests-contract", "requests-behavior", "requests-signals", "requests-harness-run"], behaviorKind: "requests-behavior", traceSchema: "engineering/controls/net-resilient-requests.trace" }),
  applicability: contractApplicability("requests-contract", "CLIENT_CONTRACT_MISSING", "perfil network-client sin contrato de llamadas de red"),
  evaluator: require("./evaluator.js"),
};
