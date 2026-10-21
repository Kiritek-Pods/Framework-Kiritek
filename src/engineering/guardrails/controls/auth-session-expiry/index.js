"use strict";

/** Implementación de `auth.session-expiry` (T22). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["session-contract", "session-behavior", "session-signals", "session-harness-run"], behaviorKind: "session-behavior", traceSchema: "engineering/controls/auth-session-expiry.trace" }),
  applicability: contractApplicability("session-contract", "SESSION_CONTRACT_MISSING", "perfil auth-session sin contrato de sesión"),
  evaluator: require("./evaluator.js"),
};
