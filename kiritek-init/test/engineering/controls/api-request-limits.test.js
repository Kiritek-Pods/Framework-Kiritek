"use strict";

// T41: `api.request-limits` — cuerpo excedido (con y sin Content-Length) y timeout con cancelación.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-request-limits/contract.js");
const { bodyOf } = require("../../../src/engineering/guardrails/controls/api-request-limits/harness.js");

const SPEC = { slug: "api-request-limits", factory: "createApiUnderTest", contractKind: "limits-contract", behaviorKind: "limits-behavior", fixtures: "limits", param: "limitsContract", harnessParams: (f) => ({ maxBodyBytes: f.maxBodyBytes, timeoutMs: f.timeoutMs, endpoints: f.endpoints }) };
const facts = (endpoint, extra = {}) => factsOf({ maxBodyBytes: 65536, timeoutMs: 2000, endpoints: [endpoint], harness: { kind: "node-adapter", adapter: "x" }, ...extra });
const FACTS = facts({ id: "create-order", method: "POST", path: "/orders", sampleBody: { sku: "k-1", qty: 1 } });

test("T41.2 la implementación correcta pasa y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
});

test("T41.2 un GET sólo prueba el timeout", async () => {
  const { trace, result } = await runControl(SPEC, "good", facts({ id: "list", method: "GET", path: "/orders" }));
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["slow@list", "fast@list"]);
});

test("T41.2 el cuerpo sintético tiene el tamaño pedido", () => {
  assert.equal(Buffer.byteLength(JSON.stringify(bodyOf({ sku: "k" }, 4096))), 4096);
});

const MATRIX = {
  "no-body-limit": ["body-limit", "body-limit-status", "body-limit-unverified", "processed-oversized"],
  "trusts-header": ["body-limit-unverified", "processed-oversized"],
  "limit-400": ["body-limit-status"],
  "process-then-reject": ["processed-oversized"],
  "tiny-limit": ["false-rejection"],
  "no-timeout": ["request-timeout"],
  "timeout-200": ["timeout-status"],
  "timeout-500": ["timeout-status"],
  "no-cancel": ["cancel-on-timeout"],
  premature: ["premature-timeout"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T41.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
