"use strict";

/** Implementación de `api.rate-limit` (T34). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["ratelimit-contract", "ratelimit-behavior", "ratelimit-signals", "ratelimit-harness-run"], behaviorKind: "ratelimit-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("ratelimit-contract", "RATE_LIMIT_CONTRACT_MISSING", "perfil http-api sin contrato de límites de uso"),
  evaluator: require("./evaluator.js"),
};
