"use strict";

/**
 * Registro de implementaciones de controles builtin, por id de catálogo.
 * Controles sin implementación quedan `unavailable` (CONTROL_NOT_IMPLEMENTED).
 */
function builtinControls() {
  return {
    "search.input-rate": require("./search-input-rate/index.js"),
    "app.minimum-supported-version": require("./app-minimum-supported-version/index.js"),
    "web.module-announcement": require("./web-module-announcement/index.js"),
  };
}

/**
 * Builtin + plugins fijados de la snapshot (T15B). El código de plugin corre
 * aislado en procesos hijo (plugins/runtime.js).
 */
function controlsFor(snapshot, { repoRoot } = {}) {
  if (!snapshot || !snapshot.plugins || !snapshot.plugins.length) return builtinControls();
  const { pluginImplementations } = require("../plugins/runtime.js");
  return { ...builtinControls(), ...pluginImplementations(snapshot, { repoRoot }) };
}

module.exports = { builtinControls, controlsFor };
