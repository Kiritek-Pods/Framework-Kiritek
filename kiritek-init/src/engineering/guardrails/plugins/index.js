"use strict";

/** Plugins / control packs verificables (T15B). Ver README.md. */
module.exports = {
  ...require("./manifest.js"),
  ...require("./permissions.js"),
  ...require("./conformance.js"),
  ...require("./loader.js"),
  ...require("./runtime.js"),
};
