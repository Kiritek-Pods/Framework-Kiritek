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
    "ui.data-states": require("./ui-data-states/index.js"),
    "ui.form-validation": require("./ui-form-validation/index.js"),
    "net.resilient-requests": require("./net-resilient-requests/index.js"),
    "flags.lifecycle": require("./flags-lifecycle/index.js"),
    "auth.session-expiry": require("./auth-session-expiry/index.js"),
    "ui.file-upload": require("./ui-file-upload/index.js"),
    "ui.pagination": require("./ui-pagination/index.js"),
    "analytics.events": require("./analytics-events/index.js"),
    "ui.destructive-actions": require("./ui-destructive-actions/index.js"),
    "i18n.formatting": require("./i18n-formatting/index.js"),
    "app.offline-mode": require("./app-offline-mode/index.js"),
    "app.device-permissions": require("./app-device-permissions/index.js"),
    "nav.broken-routes": require("./nav-broken-routes/index.js"),
    "ui.accessible-dialogs": require("./ui-accessible-dialogs/index.js"),
    "api.idempotency": require("./api-idempotency/index.js"),
    "api.error-responses": require("./api-error-responses/index.js"),
    "api.rate-limit": require("./api-rate-limit/index.js"),
    "api.pagination": require("./api-pagination/index.js"),
    "svc.dependency-failure": require("./svc-dependency-failure/index.js"),
    "svc.health-shutdown": require("./svc-health-shutdown/index.js"),
    "svc.log-hygiene": require("./svc-log-hygiene/index.js"),
    "api.concurrency": require("./api-concurrency/index.js"),
    "api.versioning": require("./api-versioning/index.js"),
    "api.request-limits": require("./api-request-limits/index.js"),
    "api.http-cache": require("./api-http-cache/index.js"),
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
