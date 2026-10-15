"use strict";

/** Adaptadores de superficie del pack engineering (T14). Ver README.md. */
module.exports = {
  ...require("./events.js"),
  ...require("./agent.js"),
  kiro: require("./kiro.js"),
  claude: require("./claude.js"),
  git: require("./git.js"),
  ci: require("./ci.js"),
  ...require("./coverage.js"),
};
