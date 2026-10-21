"use strict";

// T28: `app.offline-mode` — aviso, cola persistente, sincronización única y en orden.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "app-offline-mode", factory: "createOfflineAppUnderTest", contractKind: "offline-contract", behaviorKind: "offline-behavior", fixtures: "offline", param: "offlineContract", harnessParams: (f) => ({ indicator: f.indicator, actions: f.actions }) };
const FACTS = { indicator: "required", actions: [{ id: "pay", queue: "online-only" }, { id: "save-note", queue: "required" }], hasHarness: true, harnessKind: "node-adapter" };

test("T28.2 la implementación correcta pasa; las acciones online-only no se encolan", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["notice", "online@pay", "offline-reject@pay", "online@save-note", "queue@save-note", "restart@save-note", "order@save-note"]);
});

const MATRIX = {
  "no-notice": ["offline-indicator"],
  "error-offline": ["offline-accept", "persist-queue", "sync-once", "sync-order"],
  "no-sync": ["persist-queue", "queue-drain", "sync-once", "sync-order"],
  "double-send": ["persist-queue", "sync-once", "sync-order"],
  "keep-after-sync": ["persist-queue", "queue-drain"],
  "memory-only": ["persist-queue"],
  "reverse-order": ["sync-order"],
  "fake-success": ["online-only"],
  "queue-everything": ["online-only"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T28.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T28.2 sin aviso exigido no se prueba el aviso", async () => {
  const r = await runControl(SPEC, "no-notice", { ...FACTS, indicator: "not-applicable" });
  assert.ok(!r.trace.scenarios.some((s) => s.id === "notice"));
  assert.equal(r.result.decision, "allow");
});
