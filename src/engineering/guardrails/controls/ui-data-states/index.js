"use strict";

/** Implementación de `ui.data-states` (T18). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["states-contract", "states-behavior", "states-signals", "states-harness-run"], behaviorKind: "states-behavior", traceSchema: "engineering/controls/ui-data-states.trace" }),
  applicability: contractApplicability("states-contract", "STATES_CONTRACT_MISSING", "perfil data-views sin contrato de estados de pantalla"),
  evaluator: require("./evaluator.js"),
};
