"use strict";

/** Catálogo versionado, fijado y verificable (T02). */
module.exports = {
  semver: require("./semver.js"),
  verify: require("./verify.js"),
  load: require("./load.js"),
  registry: require("./registry.js"),
  cache: require("./cache.js"),
  conformance: require("./conformance.js"),
  resolve: require("./resolve.js"),
  diff: require("./diff.js"),
  migrate: require("./migrate.js"),
};
