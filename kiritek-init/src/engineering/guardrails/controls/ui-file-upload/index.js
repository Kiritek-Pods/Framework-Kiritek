"use strict";

/** Implementación de `ui.file-upload` (T23). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["uploads-contract", "uploads-behavior", "uploads-signals", "uploads-harness-run"], behaviorKind: "uploads-behavior", traceSchema: "engineering/controls/ui-file-upload.trace" }),
  applicability: contractApplicability("uploads-contract", "UPLOADS_CONTRACT_MISSING", "perfil file-upload sin contrato de subidas"),
  evaluator: require("./evaluator.js"),
};
