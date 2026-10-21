"use strict";

/** Runtime aislado: ejecución, sandbox, presupuestos, cache y temporales (T07). */
module.exports = {
  runner: require("./runner.js"),
  sandbox: require("./sandbox.js"),
  budget: require("./budget.js"),
  cache: require("./cache.js"),
  tempCleanup: require("./temp-cleanup.js"),
};
