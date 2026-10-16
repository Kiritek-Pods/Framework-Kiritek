"use strict";

// T33: `api.error-responses` — códigos, formato y sin detalles internos.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "api-error-responses", factory: "createApiUnderTest", contractKind: "errors-contract", behaviorKind: "errors-behavior", fixtures: "api-errors", param: "errorsContract", harnessParams: (f) => ({ errorFormat: f.errorFormat, errorFields: f.errorFields, endpoints: f.endpoints }) };
const FACTS = { errorFormat: "problem+json", errorFields: [], endpoints: [{ id: "create-order", method: "POST", path: "/orders", sampleBody: { sku: "k-sku-1", qty: 1 }, invalidBodies: [{ sku: 7 }, { sku: "k", qty: -1 }] }], hasHarness: true, harnessKind: "node-adapter" };

test("T33.2 la implementación correcta pasa y la traza sólo lleva booleanos y números", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 4);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  for (const sc of trace.scenarios) for (const st of sc.steps) for (const v of Object.values(st)) assert.ok(typeof v === "boolean" || Number.isInteger(v));
});

const MATRIX = {
  "no-validation": [
    "error-format",
    "validation-status"
  ],
  "crash-on-malformed": [
    "error-format",
    "malformed-body"
  ],
  "leak-stack": [
    "no-internal-details"
  ],
  "plain-errors": [
    "error-format"
  ],
  "not-found-200": [
    "error-format",
    "not-found-status"
  ]
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T33.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
