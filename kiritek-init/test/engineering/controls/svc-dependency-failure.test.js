"use strict";

// T36: `svc.dependency-failure` — timeout, respuesta controlada y circuit breaker que se recupera.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "svc-dependency-failure", factory: "createServiceUnderTest", contractKind: "deps-contract", behaviorKind: "deps-behavior", fixtures: "dependencies", param: "dependencyContract", harnessParams: (f) => ({ endpoint: f.endpoint, dependencies: f.dependencies }) };
const FACTS = { endpoint: { method: "GET", path: "/catalog", sampleBody: null }, dependencies: [{ id: "db", kind: "database", timeoutMs: 1000, circuitBreaker: "required", degraded: "not-applicable" }], hasHarness: true, harnessKind: "node-adapter" };

test("T36.2 la implementación correcta pasa y la traza sólo lleva booleanos y números", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 4);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  for (const sc of trace.scenarios) for (const st of sc.steps) for (const v of Object.values(st)) assert.ok(typeof v === "boolean" || Number.isInteger(v));
});

const MATRIX = {
  "no-timeout": [
    "dependency-timeout",
    "failure-response"
  ],
  "throw-on-error": [
    "failure-response"
  ],
  "status-500": [
    "failure-response"
  ],
  "no-breaker": [
    "circuit-breaker"
  ],
  "never-close": [
    "breaker-recovery"
  ]
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T36.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
