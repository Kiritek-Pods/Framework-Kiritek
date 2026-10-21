"use strict";

/** Implementación de `ui.form-validation` (T19). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["forms-contract", "forms-behavior", "forms-signals", "forms-harness-run"], behaviorKind: "forms-behavior", traceSchema: "engineering/controls/ui-form-validation.trace" }),
  applicability: contractApplicability("forms-contract", "FORMS_CONTRACT_MISSING", "perfil forms sin contrato de formularios"),
  evaluator: require("./evaluator.js"),
};
