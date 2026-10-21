"use strict";

// T49: `svc.startup-config` — fail fast con un error que nombra la variable, sin secretos.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/svc-startup-config/contract.js");
const { secretOf } = require("../../../src/engineering/guardrails/controls/svc-startup-config/harness.js");
const CASES = require("../../../src/engineering/guardrails/conformance/cases/svc-startup-config.js");

const SPEC = { slug: "svc-startup-config", factory: "startService", contractKind: "config-contract", behaviorKind: "config-behavior", fixtures: "config", param: "startupConfigContract", harnessParams: (f) => ({ variables: f.variables }) };
const FACTS = factsOf(JSON.parse(CASES.cases[0].files["apps/x/config.json"]));

test("T49.2 la implementación correcta pasa y la traza nunca lleva secretos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["valid", "missing@v-api-token", "missing@v-database-url", "missing@v-region", "invalid@v-database-url", "invalid@v-log-level", "invalid@v-port", "optional@v-log-level", "optional@v-port", "secrets"]);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  assert.ok(!JSON.stringify(trace).includes(secretOf("API_TOKEN")));
});

const MATRIX = {
  lazy: ["invalid-not-detected", "missing-not-detected"],
  "no-validation": ["invalid-not-detected"],
  "vague-error": ["unhelpful-error"],
  "dump-env": ["secret-in-config-error"],
  "port-required": ["optional-required"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T49.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
