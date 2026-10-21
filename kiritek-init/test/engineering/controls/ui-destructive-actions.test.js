"use strict";

// T26: `ui.destructive-actions` — confirmar, deshacer, ejecución única y errores claros.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "ui-destructive-actions", factory: "createActionUnderTest", contractKind: "actions-contract", behaviorKind: "actions-behavior", fixtures: "destructive", param: "actionsContract", harnessParams: (f) => ({ actions: f.actions }) };
const ACTIONS = [
  { id: "delete-account", safeguard: "confirm" },
  { id: "archive-note", safeguard: "undo", undoWindowMs: 5000 },
];
const FACTS = { actions: ACTIONS, hasHarness: true, harnessKind: "node-adapter" };

test("T26.2 la implementación correcta pasa; cada salvaguarda corre sus escenarios", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  const ids = trace.scenarios.map((s) => s.id);
  assert.ok(ids.includes("confirm-required@delete-account") && !ids.includes("undo@delete-account"));
  assert.ok(ids.includes("undo@archive-note") && !ids.includes("dismiss@archive-note"));
});

const MATRIX = {
  "no-confirm": ["confirmation", "dismiss"],
  "dismiss-executes": ["dismiss"],
  "double-run": ["double-execution"],
  "no-undo": ["undo"],
  "undo-never-executes": ["double-execution", "error-state", "execute", "message-text", "undo-window"],
  "silent-failure": ["error-state"],
  "raw-keys": ["message-text"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T26.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T26.1 contrato: ventana de deshacer ausente o corta es determinista", () => {
  const obs = [{ kind: "actions-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, actions: [{ id: "a", safeguard: "undo" }, { id: "b", safeguard: "confirm-and-undo", undoWindowMs: 100 }] } } }];
  assert.deepEqual(evaluateWith(SPEC, obs).findings.map((f) => f.fingerprint).sort(), ["uda:contract-undo-window:a", "uda:contract-undo-window:b"]);
  assert.equal(evaluateWith(SPEC, obs, { params: { minUndoWindowMs: 0 } }).findings.length, 1, "sin ventana declarada sigue siendo finding");
});
