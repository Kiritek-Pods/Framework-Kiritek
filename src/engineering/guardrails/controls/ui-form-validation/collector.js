"use strict";

/** Collector de `ui.form-validation` (T19). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadFormsContract } = require("./contract.js");
const { MAX_FORMS } = require("./scenarios.js");

const FORM_RE = /(<form\b|onSubmit=|useForm\(|FormGroup\b|TextFormField\b|reactive-form|v-model=)/;

module.exports = makeCollector({
  id: "ui-form-validation/collector",
  version: "1.0.0",
  label: "formularios",
  paramName: "formsContract",
  contractKind: "forms-contract",
  behaviorKind: "forms-behavior",
  runKind: "forms-harness-run",
  signalsKind: "forms-signals",
  traceSchema: "engineering/controls/ui-form-validation.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createFormUnderTest",
  load: loadFormsContract,
  harnessParams: (facts) => ({ forms: facts.forms.slice(0, MAX_FORMS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: FORM_RE, signal: "FORM" }),
});
