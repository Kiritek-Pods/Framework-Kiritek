"use strict";

/** Implementación de `app.offline-mode` (T28). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["offline-contract", "offline-behavior", "offline-signals", "offline-harness-run"], behaviorKind: "offline-behavior", traceSchema: "engineering/controls/app-offline-mode.trace" }),
  applicability: contractApplicability("offline-contract", "OFFLINE_CONTRACT_MISSING", "perfil offline-capable sin contrato de modo sin conexión"),
  evaluator: require("./evaluator.js"),
};
