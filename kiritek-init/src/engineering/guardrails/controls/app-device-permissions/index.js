"use strict";

/** Implementación de `app.device-permissions` (T29). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["permissions-contract", "permissions-behavior", "permissions-signals", "permissions-harness-run"], behaviorKind: "permissions-behavior", traceSchema: "engineering/controls/app-device-permissions.trace" }),
  applicability: contractApplicability("permissions-contract", "PERMISSIONS_CONTRACT_MISSING", "perfil device-permissions sin contrato de permisos"),
  evaluator: require("./evaluator.js"),
};
