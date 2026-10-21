"use strict";

/** Implementación de `api.http-cache` (T42). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["cache-contract", "cache-behavior", "cache-signals", "cache-harness-run"], behaviorKind: "cache-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("cache-contract", "CACHE_CONTRACT_MISSING", "perfil http-api sin contrato de caché HTTP"),
  evaluator: require("./evaluator.js"),
};
