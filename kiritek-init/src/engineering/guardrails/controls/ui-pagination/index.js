"use strict";

/** Implementación de `ui.pagination` (T24). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["lists-contract", "lists-behavior", "lists-signals", "lists-harness-run"], behaviorKind: "lists-behavior", traceSchema: "engineering/controls/ui-pagination.trace" }),
  applicability: contractApplicability("lists-contract", "LISTS_CONTRACT_MISSING", "perfil paginated-lists sin contrato de listas"),
  evaluator: require("./evaluator.js"),
};
