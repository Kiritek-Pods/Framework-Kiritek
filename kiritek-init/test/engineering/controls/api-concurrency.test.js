"use strict";

// T39: `api.concurrency` — versión expuesta, actualización condicional, escrituras viejas rechazadas y chequeo atómico.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-concurrency/contract.js");

const SPEC = { slug: "api-concurrency", factory: "createApiUnderTest", contractKind: "concurrency-contract", behaviorKind: "concurrency-behavior", fixtures: "concurrency", param: "concurrencyContract", harnessParams: (f) => ({ resources: f.resources }) };
const facts = (r) => factsOf({ resources: [{ id: "orders", path: "/orders/:id", mode: "etag", ...r }], harness: { kind: "node-adapter", adapter: "x" } });
const FACTS = facts({});

test("T39.2 la implementación correcta pasa (ETag y campo de versión) y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  const vf = await runControl(SPEC, "good-version-field", facts({ mode: "version-field" }));
  assert.equal(vf.result.decision, "allow", JSON.stringify(vf.result));
});

test("T39.2 requirePrecondition: false omite el escenario de precondición", async () => {
  const { trace, result } = await runControl(SPEC, "optional-precondition", facts({ requirePrecondition: false }));
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.ok(!trace.scenarios.some((s) => s.id.startsWith("precondition@")));
});

const MATRIX = {
  "no-etag": ["atomic-check", "conditional-update", "stale-rejected", "version-advances", "version-exposed"],
  "last-write-wins": ["atomic-check", "lost-update", "precondition-required", "stale-rejected"],
  "check-then-save": ["atomic-check"],
  "optional-precondition": ["precondition-required"],
  "no-bump": ["atomic-check", "lost-update", "stale-rejected", "version-advances"],
  "conflict-500": ["stale-rejected"],
  "reject-all": ["atomic-check", "conditional-update", "version-advances"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T39.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
