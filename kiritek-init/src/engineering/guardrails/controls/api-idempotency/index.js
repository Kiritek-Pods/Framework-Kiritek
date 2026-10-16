"use strict";

/** Implementación de `api.idempotency` (T32). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["idempotency-contract", "idempotency-behavior", "idempotency-signals", "idempotency-harness-run"], behaviorKind: "idempotency-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("idempotency-contract", "IDEMPOTENCY_CONTRACT_MISSING", "perfil http-api sin contrato de idempotencia"),
  evaluator: require("./evaluator.js"),
};
