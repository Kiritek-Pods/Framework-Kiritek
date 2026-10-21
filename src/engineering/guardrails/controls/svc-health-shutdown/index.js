"use strict";

/** Implementación de `svc.health-shutdown` (T37). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["health-contract", "health-behavior", "health-signals", "health-harness-run"], behaviorKind: "health-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("health-contract", "HEALTH_CONTRACT_MISSING", "perfil backend-service sin contrato de salud y apagado"),
  evaluator: require("./evaluator.js"),
};
