"use strict";

// T32: `api.idempotency` — una sola ejecución por clave, misma respuesta y rechazo de claves reutilizadas.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "api-idempotency", factory: "createApiUnderTest", contractKind: "idempotency-contract", behaviorKind: "idempotency-behavior", fixtures: "idempotency", param: "idempotencyContract", harnessParams: (f) => ({ endpoints: f.endpoints }) };
const FACTS = { endpoints: [{ id: "create-order", method: "POST", path: "/orders", keyHeader: "Idempotency-Key", requireKey: true, sampleBody: { sku: "k-sku-1", qty: 1 } }], hasHarness: true, harnessKind: "node-adapter" };

test("T32.2 la implementación correcta pasa y la traza sólo lleva booleanos y números", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  for (const sc of trace.scenarios) for (const st of sc.steps) for (const v of Object.values(st)) assert.ok(typeof v === "boolean" || Number.isInteger(v));
});

const MATRIX = {
  "no-store": [
    "concurrent-single-execution",
    "key-mismatch",
    "replay-same-response",
    "single-execution"
  ],
  "race-unsafe": [
    "concurrent-single-execution"
  ],
  "different-replay": [
    "replay-same-response"
  ],
  "ignore-body": [
    "key-mismatch"
  ],
  "optional-key": [
    "key-required"
  ]
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T32.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
