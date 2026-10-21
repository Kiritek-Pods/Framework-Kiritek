"use strict";

/** Collector de `api.pagination` (T35). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadPaginationContract } = require("./contract.js");

const SIGNAL_RE = /(\.findMany\(|\.find\(\)|\.limit\(|LIMIT \$?\d|OFFSET|Pageable|paginate\(|\.skip\()/;

module.exports = makeCollector({
  id: "api-pagination/collector",
  version: "1.0.0",
  label: "paginación de API",
  paramName: "paginationContract",
  contractKind: "apipage-contract",
  behaviorKind: "apipage-behavior",
  runKind: "apipage-harness-run",
  signalsKind: "apipage-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadPaginationContract,
  harnessParams: (facts) => ({ collections: facts.collections.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "LIST_ENDPOINT" }),
});
