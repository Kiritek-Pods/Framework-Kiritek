"use strict";

/** Collector de `app.device-permissions` (T29). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadPermissionsContract } = require("./contract.js");
const { MAX_PERMISSIONS } = require("./scenarios.js");

const PERMISSION_RE = /(getUserMedia\(|geolocation\.|Notification\.requestPermission|requestPermission(?:s|Async)?\(|PermissionsAndroid|ActivityCompat\.requestPermissions|requestWhenInUseAuthorization|AVCaptureDevice\.requestAccess|permission_handler)/;

module.exports = makeCollector({
  id: "app-device-permissions/collector",
  version: "1.0.0",
  label: "permisos del dispositivo",
  paramName: "permissionsContract",
  contractKind: "permissions-contract",
  behaviorKind: "permissions-behavior",
  runKind: "permissions-harness-run",
  signalsKind: "permissions-signals",
  traceSchema: "engineering/controls/app-device-permissions.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createPermissionsUnderTest",
  load: loadPermissionsContract,
  harnessParams: (facts) => ({ permissions: facts.permissions.slice(0, MAX_PERMISSIONS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: PERMISSION_RE, signal: "PERMISSION_REQUEST" }),
});
