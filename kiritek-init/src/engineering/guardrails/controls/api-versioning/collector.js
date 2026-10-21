"use strict";

/** Collector de `api.versioning` (T40). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadVersioningContract } = require("./contract.js");

const SIGNAL_RE = /(['"`]\/v\d+\/|api-version|Accept-Version|@Deprecated|deprecated:\s*true|apiVersion)/;

module.exports = makeCollector({
  id: "api-versioning/collector",
  version: "1.0.0",
  label: "versionado de API",
  paramName: "versioningContract",
  contractKind: "versioning-contract",
  behaviorKind: "versioning-behavior",
  runKind: "versioning-harness-run",
  signalsKind: "versioning-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadVersioningContract,
  harnessParams: (facts) => ({ scheme: facts.scheme, header: facts.header, versions: facts.versions, endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "VERSIONED_ROUTE" }),
});
