"use strict";

/** Collector de `ui.accessible-dialogs` (T31). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadDialogsContract } = require("./contract.js");
const { MAX_DIALOGS } = require("./scenarios.js");

const DIALOG_RE = /(<dialog\b|role=["'](?:dialog|alertdialog|menu)["']|\bModal\b|\bDrawer\b|showModal\(|aria-modal|BottomSheet|AlertDialog)/;

module.exports = makeCollector({
  id: "ui-accessible-dialogs/collector",
  version: "1.0.0",
  label: "diálogos",
  paramName: "dialogsContract",
  contractKind: "dialogs-contract",
  behaviorKind: "dialogs-behavior",
  runKind: "dialogs-harness-run",
  signalsKind: "dialogs-signals",
  traceSchema: "engineering/controls/ui-accessible-dialogs.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createDialogUnderTest",
  load: loadDialogsContract,
  harnessParams: (facts) => ({ dialogs: facts.dialogs.slice(0, MAX_DIALOGS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: DIALOG_RE, signal: "DIALOG" }),
});
