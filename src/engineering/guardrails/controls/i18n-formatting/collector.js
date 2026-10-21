"use strict";

/** Collector de `i18n.formatting` (T27). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadI18nContract } = require("./contract.js");

const FORMAT_RE = /(\.toFixed\(|getDate\(\)\s*\+\s*["'/]|["']\$["']\s*\+|toLocaleString\(\)|\bmoment\(|dateFormat\(|DateFormat\(|NumberFormat\()/;

module.exports = makeCollector({
  id: "i18n-formatting/collector",
  version: "1.0.0",
  label: "localización",
  paramName: "i18nContract",
  contractKind: "i18n-contract",
  behaviorKind: "i18n-behavior",
  runKind: "i18n-harness-run",
  signalsKind: "i18n-signals",
  traceSchema: "engineering/controls/i18n-formatting.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createFormatterUnderTest",
  load: loadI18nContract,
  harnessParams: (facts) => ({ locales: facts.locales, defaultLocale: facts.defaultLocale, currency: facts.currency, formats: facts.formats }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: FORMAT_RE, signal: "HARDCODED_FORMAT" }),
});
