"use strict";

/** Implementación de `web.module-announcement` (T12). Ver README.md. */
module.exports = {
  collectors: [require("./collector.js")],
  normalizer: require("./normalizer.js"),
  applicability: require("./applicability.js").applicability,
  evaluator: require("./evaluator.js"),
};
