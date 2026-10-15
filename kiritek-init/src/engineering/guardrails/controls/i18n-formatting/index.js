"use strict";

/** Implementación de `i18n.formatting` (T27). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["i18n-contract", "i18n-behavior", "i18n-signals", "i18n-harness-run"], behaviorKind: "i18n-behavior", traceSchema: "engineering/controls/i18n-formatting.trace" }),
  applicability: contractApplicability("i18n-contract", "I18N_CONTRACT_MISSING", "perfil localized sin contrato de localización"),
  evaluator: require("./evaluator.js"),
};
