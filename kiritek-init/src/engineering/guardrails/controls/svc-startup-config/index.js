"use strict";

/** Implementación de `svc.startup-config` (T49). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["config-contract", "config-behavior", "config-signals", "config-harness-run"], behaviorKind: "config-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("config-contract", "CONFIG_CONTRACT_MISSING", "perfil backend-service sin contrato de configuración"),
  evaluator: require("./evaluator.js"),
};
