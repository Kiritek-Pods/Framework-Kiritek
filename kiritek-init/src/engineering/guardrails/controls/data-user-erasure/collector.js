"use strict";

/** Collector de `data.user-erasure` (T47). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadErasureContract } = require("./contract.js");

const SIGNAL_RE = /(deleteAccount|delete_account|eraseUser|anonymi[sz]e|gdpr|right.to.be.forgotten|\/me\b.*delete|DELETE FROM users)/i;

module.exports = makeCollector({
  id: "data-user-erasure/collector",
  version: "1.0.0",
  label: "borrado de datos del usuario",
  paramName: "erasureContract",
  contractKind: "erasure-contract",
  behaviorKind: "erasure-behavior",
  runKind: "erasure-harness-run",
  signalsKind: "erasure-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createServiceUnderTest",
  load: loadErasureContract,
  harnessParams: (facts) => ({ erasure: facts.erasure, stores: facts.stores.slice(0, 10), reads: facts.reads.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "USER_ERASURE" }),
});
