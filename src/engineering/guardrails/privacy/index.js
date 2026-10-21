"use strict";

/** Privacidad y evidencia (T08). */
module.exports = {
  minimize: require("./minimize.js"),
  redact: require("./redact.js"),
  validateOutput: require("./validate-output.js"),
  publish: require("./publish.js"),
  evidenceStore: require("./evidence-store.js"),
};
