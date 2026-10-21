"use strict";

// T45: `api.batch` — resultados por ítem, éxito parcial explícito o todo-o-nada real, tope y lote vacío.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-batch/contract.js");

const SPEC = { slug: "api-batch", factory: "createApiUnderTest", contractKind: "batch-contract", behaviorKind: "batch-behavior", fixtures: "batch", param: "batchContract", harnessParams: (f) => ({ endpoints: f.endpoints }) };
const facts = (mode) => factsOf({ endpoints: [{ id: "orders", path: "/orders/batch", mode, maxItems: 50, sampleItem: { sku: "k-1", qty: 1 }, invalidItem: { sku: "", qty: -1 } }], harness: { kind: "node-adapter", adapter: "x" } });
const PARTIAL = facts("partial");
const ATOMIC = facts("atomic");

test("T45.2 las implementaciones correctas pasan en su modo y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", PARTIAL);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  assert.equal((await runControl(SPEC, "good-atomic", ATOMIC)).result.decision, "allow");
});

test("T45.3 cada modo exige lo suyo: el adapter del otro modo falla", async () => {
  assert.deepEqual((await runControl(SPEC, "good-atomic", PARTIAL)).rules, ["partial-lost", "silent-failure"]);
  assert.deepEqual((await runControl(SPEC, "good", ATOMIC)).rules, ["not-atomic", "silent-failure"]);
});

const MATRIX = {
  "stop-on-error": [PARTIAL, ["partial-lost", "silent-failure"]],
  "hide-errors": [PARTIAL, ["silent-failure"]],
  "fail-whole": [PARTIAL, ["partial-lost", "silent-failure"]],
  reversed: [PARTIAL, ["batch-results"]],
  "no-limit": [PARTIAL, ["batch-limit"]],
  "empty-500": [PARTIAL, ["empty-batch"]],
  "no-rollback": [ATOMIC, ["not-atomic"]],
};
for (const [adapter, [f, rules]] of Object.entries(MATRIX)) {
  test(`T45.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, f);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
