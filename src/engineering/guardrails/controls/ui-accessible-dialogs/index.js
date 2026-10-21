"use strict";

/** Implementación de `ui.accessible-dialogs` (T31). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["dialogs-contract", "dialogs-behavior", "dialogs-signals", "dialogs-harness-run"], behaviorKind: "dialogs-behavior", traceSchema: "engineering/controls/ui-accessible-dialogs.trace" }),
  applicability: contractApplicability("dialogs-contract", "DIALOGS_CONTRACT_MISSING", "perfil dialogs sin contrato de diálogos"),
  evaluator: require("./evaluator.js"),
};
