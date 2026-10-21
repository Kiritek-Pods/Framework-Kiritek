"use strict";

/**
 * Implementación de `search.input-rate` (T10). Enlazada con el catálogo:
 * collector `search-input-rate/collector`. Ver README.md.
 */
module.exports = {
  collectors: [require("./collector.js")],
  normalizer: require("./normalizer.js"),
  applicability: require("./applicability.js").applicability,
  evaluator: require("./evaluator.js"),
};
