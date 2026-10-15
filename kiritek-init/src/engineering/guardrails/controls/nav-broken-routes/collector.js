"use strict";

/** Collector de `nav.broken-routes` (T30). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadRoutesContract } = require("./contract.js");

const ROUTER_RE = /(createBrowserRouter|<Route\b|useRouter\(|RouterModule\.forRoot|createRouter\(|NavigationContainer|GoRouter\(|NavHost\()/;

module.exports = makeCollector({
  id: "nav-broken-routes/collector",
  version: "1.0.0",
  label: "rutas",
  paramName: "routesContract",
  contractKind: "routes-contract",
  behaviorKind: "routes-behavior",
  runKind: "routes-harness-run",
  signalsKind: "routes-signals",
  traceSchema: "engineering/controls/nav-broken-routes.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createRouterUnderTest",
  load: loadRoutesContract,
  harnessParams: (facts) => ({ routes: facts.routes, deepLinks: facts.deepLinks }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: ROUTER_RE, signal: "ROUTER" }),
});
