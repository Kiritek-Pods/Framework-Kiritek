"use strict";

// T44: `api.long-operations` — 202 con estado consultable, final informado y sin operaciones eternas.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-long-operations/contract.js");

const SPEC = { slug: "api-long-operations", factory: "createApiUnderTest", contractKind: "longops-contract", behaviorKind: "longops-behavior", fixtures: "longops", param: "operationsContract", harnessParams: (f) => ({ operations: f.operations }) };
const FACTS = factsOf({ operations: [{ id: "report", path: "/reports", statusPath: "/operations/:id", sampleBody: { month: "2026-05" }, maxDurationMs: 60000 }], harness: { kind: "node-adapter", adapter: "x" } });

test("T44.2 la implementación correcta pasa y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  assert.ok(!JSON.stringify(trace).includes("kcanary"));
});

const MATRIX = {
  sync: ["failure-not-reported", "never-completes", "not-async", "status-location", "stuck-forever"],
  "no-location": ["failure-not-reported", "never-completes", "status-location", "stuck-forever"],
  "never-finishes": ["never-completes"],
  "swallow-failure": ["failure-not-reported"],
  "leak-error": ["failure-leak"],
  "no-timeout": ["stuck-forever"],
  "no-cancel": ["not-cancelled"],
  "unknown-200": ["unknown-operation"],
  "unknown-500": ["unknown-operation"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T44.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
