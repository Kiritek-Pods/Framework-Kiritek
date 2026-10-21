"use strict";

/** Implementación de `nav.broken-routes` (T30). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["routes-contract", "routes-behavior", "routes-signals", "routes-harness-run"], behaviorKind: "routes-behavior", traceSchema: "engineering/controls/nav-broken-routes.trace" }),
  applicability: contractApplicability("routes-contract", "ROUTES_CONTRACT_MISSING", "perfil routed-app sin contrato de rutas"),
  evaluator: require("./evaluator.js"),
};
