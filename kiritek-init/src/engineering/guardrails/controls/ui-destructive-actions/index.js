"use strict";

/** Implementación de `ui.destructive-actions` (T26). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["actions-contract", "actions-behavior", "actions-signals", "actions-harness-run"], behaviorKind: "actions-behavior", traceSchema: "engineering/controls/ui-destructive-actions.trace" }),
  applicability: contractApplicability("actions-contract", "ACTIONS_CONTRACT_MISSING", "perfil destructive-actions sin contrato de acciones destructivas"),
  evaluator: require("./evaluator.js"),
};
