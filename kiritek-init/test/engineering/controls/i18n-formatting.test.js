"use strict";

// T27: `i18n.formatting` — convenciones del idioma contra Intl, zona horaria y respaldo.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const H = require("../../../src/engineering/guardrails/controls/i18n-formatting/harness.js");

const SPEC = { slug: "i18n-formatting", factory: "createFormatterUnderTest", contractKind: "i18n-contract", behaviorKind: "i18n-behavior", fixtures: "i18n", param: "i18nContract", harnessParams: (f) => ({ locales: f.locales, defaultLocale: f.defaultLocale, currency: f.currency, formats: f.formats }) };
const FACTS = { locales: ["en-US", "es-CL", "ja-JP"], defaultLocale: "en-US", currency: "CLP", formats: ["currency", "date", "messages", "number", "timezone"], hasHarness: true, harnessKind: "node-adapter" };

test("T27.2 los verificadores siguen a Intl sin exigir un texto exacto", () => {
  assert.equal(H.checkNumber("1.234.567,89", "es-CL"), true);
  assert.equal(H.checkNumber("1,234,567.89", "es-CL"), false);
  assert.equal(H.checkDate("4 mar 2026", "es-CL"), true);
  assert.equal(H.checkDate("3/4/2026", "es-CL"), false);
  assert.equal(H.checkDate("3/4/2026", "en-US"), true);
  const ms = H.instantFor("America/Santiago");
  assert.notEqual(new Date(ms).getUTCDate(), Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/Santiago" }).format(ms)));
});

test("T27.2 la implementación correcta (Intl) pasa y la traza no lleva textos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 14);
  assert.ok(!JSON.stringify(trace).includes("2026") && !JSON.stringify(trace).includes("Hola"));
});

const MATRIX = {
  "fixed-locale": ["number-format"],
  "manual-date": ["date-format", "time-zone"],
  "to-fixed": ["number-format"],
  "no-currency": ["currency-format"],
  "ignore-time-zone": ["time-zone"],
  "no-fallback": ["locale-fallback", "missing-message"],
  "raw-missing": ["missing-message"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T27.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T27.1 contrato: el idioma por defecto debe estar entre los declarados", () => {
  const obs = [{ kind: "i18n-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, defaultLocale: "pt-BR" } } }];
  assert.equal(evaluateWith(SPEC, obs).findings[0].ruleId, "i18n.formatting/contract-default-locale");
});
