"use strict";

/** Collector de `api.http-cache` (T42). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadCacheContract } = require("./contract.js");

const SIGNAL_RE = /(Cache-Control|cache-control|ETag|etag\(|Last-Modified|If-None-Match|@Cacheable|fresh\(|res\.set\(\s*['"]Cache)/;

module.exports = makeCollector({
  id: "api-http-cache/collector",
  version: "1.0.0",
  label: "caché HTTP",
  paramName: "cacheContract",
  contractKind: "cache-contract",
  behaviorKind: "cache-behavior",
  runKind: "cache-harness-run",
  signalsKind: "cache-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadCacheContract,
  harnessParams: (facts) => ({ resources: facts.resources.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "HTTP_CACHE" }),
});
