"use strict";

/** Implementación de `api.pagination` (T35). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["apipage-contract", "apipage-behavior", "apipage-signals", "apipage-harness-run"], behaviorKind: "apipage-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("apipage-contract", "PAGINATION_CONTRACT_MISSING", "perfil http-api sin contrato de paginación"),
  evaluator: require("./evaluator.js"),
};
