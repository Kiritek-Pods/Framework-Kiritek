"use strict";

/** Implementación de `api.batch` (T45). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["batch-contract", "batch-behavior", "batch-signals", "batch-harness-run"], behaviorKind: "batch-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("batch-contract", "BATCH_CONTRACT_MISSING", "perfil http-api sin contrato de operaciones en lote"),
  evaluator: require("./evaluator.js"),
};
