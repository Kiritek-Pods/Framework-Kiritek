"use strict";

/**
 * Contratos versionados del pack engineering/guardrails (T01).
 * Ver `README.md` en este directorio.
 */

module.exports = {
  common: require("./common.js"),
  profile: require("./profile.js"),
  unit: require("./unit.js"),
  control: require("./control.js"),
  catalog: require("./catalog.js"),
  observation: require("./observation.js"),
  applicability: require("./applicability.js"),
  evidence: require("./evidence.js"),
  practiceInput: require("./practice-input.js"),
  policyResult: require("./policy-result.js"),
  resultEnvelope: require("./result-envelope.js"),
  domain: require("./domain.js"),
};
