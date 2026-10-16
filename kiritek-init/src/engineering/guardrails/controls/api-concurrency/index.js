"use strict";

/** Implementación de `api.concurrency` (T39). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["concurrency-contract", "concurrency-behavior", "concurrency-signals", "concurrency-harness-run"], behaviorKind: "concurrency-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("concurrency-contract", "CONCURRENCY_CONTRACT_MISSING", "perfil http-api sin contrato de edición concurrente"),
  evaluator: require("./evaluator.js"),
};
