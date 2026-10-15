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
  },
  runtime: require("./runtime/index.js"),
  privacy: require("./privacy/index.js"),
  orchestrator: require("./orchestrator.js"),
  controls: require("./controls/index.js"),
  install: require("./install/index.js"),
  cli: require("./cli.js"),
};
