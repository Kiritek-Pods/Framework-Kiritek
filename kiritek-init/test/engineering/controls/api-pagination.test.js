"use strict";

// T35: `api.pagination` — tamaños, recorrido completo sin duplicados y cursor estable.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "api-pagination", factory: "createApiUnderTest", contractKind: "apipage-contract", behaviorKind: "apipage-behavior", fixtures: "api-pagination", param: "paginationContract", harnessParams: (f) => ({ collections: f.collections }) };
const FACTS = require("../../../src/engineering/guardrails/controls/api-pagination/contract.js").factsOf({ collections: [{ id: "orders", path: "/orders", mode: "cursor", defaultPageSize: 20, maxPageSize: 100 }], harness: { kind: "node-adapter", adapter: "x" } });

test("T35.2 la implementación correcta pasa y la traza sólo lleva booleanos y números", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 6);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  for (const sc of trace.scenarios) for (const st of sc.steps) for (const v of Object.values(st)) assert.ok(typeof v === "boolean" || Number.isInteger(v));
});

const MATRIX = {
  "wrong-default": [
    "default-page-size"
  ],
  "no-max": [
    "max-page-size"
  ],
  "crash-bad-limit": [
    "invalid-limit"
  ],
  "offset-cursor": [
    "invalid-cursor",
    "stable-cursor"
  ],
  "lenient-cursor": [
    "invalid-cursor"
  ],
  overlap: [
    "duplicates",
    "order",
    "stable-cursor"
  ],
  "no-end": [
    "end-detection"
  ],
  shuffle: [
    "order"
  ]
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T35.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
