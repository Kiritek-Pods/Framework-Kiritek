"use strict";

/** Collector de `api.response-schema` (T43). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadResponseSchemaContract } = require("./contract.js");

const SIGNAL_RE = /(openapi:|"openapi"|swagger|@ApiResponse|zod|z\.object\(|responseSchema|res\.json\()/;

module.exports = makeCollector({
  id: "api-response-schema/collector",
  version: "1.0.0",
  label: "schemas de respuesta",
  paramName: "responseSchemaContract",
  contractKind: "respschema-contract",
  behaviorKind: "respschema-behavior",
  runKind: "respschema-harness-run",
  signalsKind: "respschema-signals",
  traceSchema: "engineering/controls/facts.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createApiUnderTest",
  load: loadResponseSchemaContract,
  harnessParams: (facts) => ({ errorSchema: facts.errorSchema, endpoints: facts.endpoints.slice(0, 5) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: SIGNAL_RE, signal: "API_SCHEMA" }),
});
