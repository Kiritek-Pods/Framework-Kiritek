"use strict";

// T31: `ui.accessible-dialogs` — foco, teclado, Escape/clic afuera, rol y fondo inerte.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "ui-accessible-dialogs", factory: "createDialogUnderTest", contractKind: "dialogs-contract", behaviorKind: "dialogs-behavior", fixtures: "dialogs", param: "dialogsContract", harnessParams: (f) => ({ dialogs: f.dialogs }) };
const FACTS = { dialogs: [{ id: "account-menu", kind: "menu", dismissible: true }, { id: "confirm-delete", kind: "modal", dismissible: false }, { id: "filters", kind: "drawer", dismissible: true }], hasHarness: true, harnessKind: "node-adapter" };

test("T31.2 la implementación correcta pasa; los menús no exigen foco atrapado ni fondo inerte", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  const ids = trace.scenarios.map((s) => s.id);
  assert.ok(!ids.includes("focus-trap@account-menu") && ids.includes("focus-trap@confirm-delete"));
  assert.equal(ids.length, 16);
});

const MATRIX = {
  "no-focus-in": ["focus-in", "focus-trap"],
  "no-trap": ["focus-trap"],
  "no-escape": ["escape-close", "focus-return"],
  "no-focus-return": ["focus-return"],
  "escape-always": ["escape-close"],
  "wrong-role": ["role"],
  unlabelled: ["accessible-name"],
  "live-background": ["background-inert"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T31.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
