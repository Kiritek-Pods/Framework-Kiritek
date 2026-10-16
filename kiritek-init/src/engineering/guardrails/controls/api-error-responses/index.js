"use strict";

/** Implementación de `api.error-responses` (T33). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["errors-contract", "errors-behavior", "errors-signals", "errors-harness-run"], behaviorKind: "errors-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("errors-contract", "ERRORS_CONTRACT_MISSING", "perfil http-api sin contrato de errores"),
  evaluator: require("./evaluator.js"),
};
