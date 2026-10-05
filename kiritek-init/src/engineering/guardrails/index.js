"use strict";

/**
 * API pública del pack engineering/guardrails.
 * Ver README.md en este directorio.
 */
module.exports = {
  contracts: require("./contracts/index.js"),
  catalog: require("./catalog/index.js"),
  config: require("./config/index.js"),
  workspace: require("./workspace/index.js"),
  pipeline: {
    collect: require("./pipeline/collect.js"),
    normalize: require("./pipeline/normalize.js"),
    applicability: require("./pipeline/applicability.js"),
    evaluate: require("./pipeline/evaluate.js"),
    exceptions: require("./pipeline/exceptions.js"),
    aggregate: require("./pipeline/aggregate.js"),
    redact: require("./pipeline/redact.js"),
  },
  orchestrator: require("./orchestrator.js"),
};
