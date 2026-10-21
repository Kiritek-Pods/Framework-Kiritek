"use strict";

/** Implementación de `db.compatible-migrations` (T46). Ver README.md. */
const { contractApplicability } = require("../shared/applicability.js");
const { makeNormalizer } = require("../shared/normalizer.js");

module.exports = {
  collectors: [require("./collector.js")],
  normalizer: makeNormalizer({ kinds: ["migrations-contract", "migrations-behavior", "migrations-signals", "migrations-harness-run"], behaviorKind: "migrations-behavior", traceSchema: "engineering/controls/facts.trace" }),
  applicability: contractApplicability("migrations-contract", "MIGRATIONS_CONTRACT_MISSING", "perfil backend-service sin contrato de migraciones"),
  evaluator: require("./evaluator.js"),
};
