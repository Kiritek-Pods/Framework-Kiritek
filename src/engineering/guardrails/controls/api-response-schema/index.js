"use strict";

/** Implementación de `api.response-schema` (T43). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["respschema-contract", "respschema-behavior", "respschema-signals", "respschema-harness-run"], behaviorKind: "respschema-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("respschema-contract", "RESPONSE_SCHEMA_CONTRACT_MISSING", "perfil http-api sin contrato de schemas de respuesta"),
  evaluator: require("./evaluator.js"),
};
