"use strict";

// T37: `svc.health-shutdown` — liveness, readiness y apagado ordenado.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "svc-health-shutdown", factory: "createServiceUnderTest", contractKind: "health-contract", behaviorKind: "health-behavior", fixtures: "health", param: "healthContract", harnessParams: (f) => ({ ...f }) };
const FACTS = { livenessPath: "/livez", readinessPath: "/readyz", dependencies: ["db"], work: { method: "POST", path: "/reports" }, shutdownGraceMs: 10000, hasHarness: true, harnessKind: "node-adapter" };

test("T37.2 la implementación correcta pasa y la traza sólo lleva booleanos y números", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  for (const sc of trace.scenarios) for (const st of sc.steps) for (const v of Object.values(st)) assert.ok(typeof v === "boolean" || Number.isInteger(v));
});

const MATRIX = {
  "liveness-checks-db": [
    "liveness-independent"
  ],
  "ready-ignores-db": [
    "readiness-checks-deps"
  ],
  "ready-while-stopping": [
    "not-ready-on-shutdown"
  ],
  "accept-while-stopping": [
    "reject-new-work"
  ],
  "no-grace-timeout": [
    "grace-period"
  ]
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T37.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
