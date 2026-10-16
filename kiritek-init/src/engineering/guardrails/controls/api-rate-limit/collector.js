"use strict";

/** Collector de `api.rate-limit` (T34). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadRateLimitContract } = require("./contract.js");

const SIGNAL_RE = /(express\(\)|fastify\(|new Hono\(|@RestController|FastAPI\(|rateLimit\(|express-rate-limit|@Throttle|slowapi)/;

module.exports = makeCollector({
  id: "api-rate-limit/collector",
  version: "1.0.0",
  label: "límites de uso",
  paramName: "rateLimitContract",
  contractKind: "ratelimit-contract",
  behaviorKind: "ratelimit-behavior",
  runKind: "ratelimit-harness-run",
  signalsKind: "ratelimit-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadRateLimitContract,
  harnessParams: (facts) => ({ limits: facts.limits.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "PUBLIC_ENDPOINT" }),
});
