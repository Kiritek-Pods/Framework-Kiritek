"use strict";

/** Implementación de `svc.log-hygiene` (T38). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["logs-contract", "logs-behavior", "logs-signals", "logs-harness-run"], behaviorKind: "logs-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("logs-contract", "LOGS_CONTRACT_MISSING", "perfil backend-service sin contrato de logs"),
  evaluator: require("./evaluator.js"),
};
