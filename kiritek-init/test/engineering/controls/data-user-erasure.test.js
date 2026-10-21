"use strict";

// T47: `data.user-erasure` — sin rastros en ningún almacén, sin daño colateral y sin reapariciones.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/data-user-erasure/contract.js");
const { USERS } = require("../../../src/engineering/guardrails/controls/data-user-erasure/harness.js");

const SPEC = { slug: "data-user-erasure", factory: "createServiceUnderTest", contractKind: "erasure-contract", behaviorKind: "erasure-behavior", fixtures: "erasure", param: "erasureContract", harnessParams: (f) => ({ erasure: f.erasure, stores: f.stores, reads: f.reads }) };
const FACTS = factsOf({ erasure: { method: "DELETE", path: "/users/:userId" }, stores: [{ id: "users" }, { id: "orders" }, { id: "events" }], readEndpoints: [{ id: "admin-list", path: "/admin/users" }], harness: { kind: "node-adapter", adapter: "x" } });

test("T47.2 el borrado completo pasa y la traza nunca lleva los datos canario", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["store@events", "store@orders", "store@users", "others", "reads", "repeat", "unknown"]);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  const text = JSON.stringify(trace);
  for (const u of Object.values(USERS)) for (const v of Object.values(u)) assert.ok(!text.includes(v));
});

test("T47.3 el finding señala el almacén que quedó con rastros", async () => {
  const r = await runControl(SPEC, "forget-orders", FACTS);
  assert.deepEqual(r.result.findings.map((f) => f.fingerprint), ["due:erasure-incomplete:store@orders"]);
});

const MATRIX = {
  "forget-orders": ["erasure-incomplete"],
  "soft-delete": ["erased-reappears", "erasure-incomplete"],
  "partial-anon": ["erasure-incomplete"],
  "delete-everyone": ["collateral-deletion"],
  "stale-cache": ["erased-reappears"],
  "repeat-500": ["erasure-not-idempotent"],
  "unknown-500": ["erasure-unknown-user"],
  "unknown-deletes": ["erasure-unknown-user"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T47.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
