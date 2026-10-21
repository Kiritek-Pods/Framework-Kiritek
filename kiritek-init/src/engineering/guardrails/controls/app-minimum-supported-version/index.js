"use strict";

/** Implementación de `app.minimum-supported-version` (T11). Ver README.md. */
module.exports = {
  collectors: [require("./collector.js")],
  normalizer: require("./normalizer.js"),
  applicability: require("./applicability.js").applicability,
  evaluator: require("./evaluator.js"),
};
