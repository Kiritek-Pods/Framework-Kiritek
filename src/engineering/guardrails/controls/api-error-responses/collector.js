"use strict";

/** Collector de `api.error-responses` (T33). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadErrorsContract } = require("./contract.js");

const SIGNAL_RE = /(express\(\)|fastify\(|new Hono\(|@RestController|@app\.(?:get|post)|FastAPI\(|http\.HandleFunc|router\.(?:get|post)\()/;

module.exports = makeCollector({
  id: "api-error-responses/collector",
  version: "1.0.0",
  label: "errores de API",
  paramName: "errorsContract",
  contractKind: "errors-contract",
  behaviorKind: "errors-behavior",
  runKind: "errors-harness-run",
  signalsKind: "errors-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadErrorsContract,
  harnessParams: (facts) => ({ errorFormat: facts.errorFormat, errorFields: facts.errorFields, endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "API_HANDLER" }),
});
