"use strict";

/** Collector de `net.resilient-requests` (T20). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadClientContract } = require("./contract.js");
const { MAX_OPERATIONS } = require("./scenarios.js");

const HTTP_RE = /\b(fetch\(|axios[.(]|got\(|ky\.|http\.(?:get|post|request)\(|HttpClient\b|OkHttpClient\b|URLSession\b|Dio\(|requests\.(?:get|post))/;

module.exports = makeCollector({
  id: "net-resilient-requests/collector",
  version: "1.0.0",
  label: "llamadas de red",
  paramName: "clientContract",
  contractKind: "requests-contract",
  behaviorKind: "requests-behavior",
  runKind: "requests-harness-run",
  signalsKind: "requests-signals",
  traceSchema: "engineering/controls/net-resilient-requests.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createClientUnderTest",
  load: loadClientContract,
  harnessParams: (facts) => ({ operations: facts.operations.slice(0, MAX_OPERATIONS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: HTTP_RE, signal: "HTTP_CALL" }),
});
