"use strict";

/** Collector de `auth.session-expiry` (T22). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadSessionContract } = require("./contract.js");

const SESSION_RE = /(\b401\b|refreshToken|refresh_token|accessToken|access_token|Authorization|onUnauthorized|tokenExpired|session(?:Expired|Timeout))/;

module.exports = makeCollector({
  id: "auth-session-expiry/collector",
  version: "1.0.0",
  label: "sesión",
  paramName: "sessionContract",
  contractKind: "session-contract",
  behaviorKind: "session-behavior",
  runKind: "session-harness-run",
  signalsKind: "session-signals",
  traceSchema: "engineering/controls/auth-session-expiry.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createSessionUnderTest",
  load: loadSessionContract,
  harnessParams: (facts) => ({ session: facts.session }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SESSION_RE, signal: "SESSION_HANDLING" }),
});
