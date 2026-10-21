"use strict";

/** Collector de `ui.destructive-actions` (T26). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadActionsContract } = require("./contract.js");
const { MAX_ACTIONS } = require("./scenarios.js");

const DESTRUCTIVE_RE = /(\bdelete[A-Z(]|\bremove[A-Z(]|\.delete\(|method:\s*["']DELETE["']|\bcancel(?:Subscription|Order|Account)\b|\bdestroy\(|\bpurge\(|\bwipe\()/;

module.exports = makeCollector({
  id: "ui-destructive-actions/collector",
  version: "1.0.0",
  label: "acciones destructivas",
  paramName: "actionsContract",
  contractKind: "actions-contract",
  behaviorKind: "actions-behavior",
  runKind: "actions-harness-run",
  signalsKind: "actions-signals",
  traceSchema: "engineering/controls/ui-destructive-actions.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createActionUnderTest",
  load: loadActionsContract,
  harnessParams: (facts) => ({ actions: facts.actions.slice(0, MAX_ACTIONS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: DESTRUCTIVE_RE, signal: "DESTRUCTIVE_ACTION" }),
});
