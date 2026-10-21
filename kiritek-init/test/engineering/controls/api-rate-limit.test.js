"use strict";

// T34: `api.rate-limit` — límite, 429 con Retry-After, conteo por cliente y reinicio de ventana.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "api-rate-limit", factory: "createApiUnderTest", contractKind: "ratelimit-contract", behaviorKind: "ratelimit-behavior", fixtures: "rate-limit", param: "rateLimitContract", harnessParams: (f) => ({ limits: f.limits }) };
const FACTS = { limits: [{ id: "search", method: "GET", path: "/search", limit: 5, windowSeconds: 60, by: "api-key" }], hasHarness: true, harnessKind: "node-adapter" };

test("T34.2 la implementación correcta pasa y la traza sólo lleva booleanos y números", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 1);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  for (const sc of trace.scenarios) for (const st of sc.steps) for (const v of Object.values(st)) assert.ok(typeof v === "boolean" || Number.isInteger(v));
});

const MATRIX = {
  "no-limit": [
    "limit-enforced",
    "retry-after"
  ],
  "off-by-one": [
    "under-limit"
  ],
  "no-retry-after": [
    "retry-after"
  ],
  global: [
    "per-client"
  ],
  "no-reset": [
    "window-reset"
  ]
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T34.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
