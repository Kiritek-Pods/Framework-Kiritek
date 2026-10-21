"use strict";

/** Collector de `ui.data-states` (T18). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadStatesContract } = require("./contract.js");
const { MAX_SCREENS } = require("./scenarios.js");

const DATA_LOAD_RE = /\b(fetch\(|axios\.|useQuery\(|useSWR\(|http\.(?:get|post)\(|HttpClient\b|FutureBuilder\b|URLSession\b|Retrofit\b)/;

module.exports = makeCollector({
  id: "ui-data-states/collector",
  version: "1.0.0",
  label: "estados de pantalla",
  paramName: "statesContract",
  contractKind: "states-contract",
  behaviorKind: "states-behavior",
  runKind: "states-harness-run",
  signalsKind: "states-signals",
  traceSchema: "engineering/controls/ui-data-states.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createScreenUnderTest",
  load: loadStatesContract,
  harnessParams: (facts) => ({ screens: facts.screens.slice(0, MAX_SCREENS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: DATA_LOAD_RE, signal: "DATA_LOADING" }),
});
