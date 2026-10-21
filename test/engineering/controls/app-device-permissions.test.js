"use strict";

// T29: `app.device-permissions` — pedir en contexto, explicar, tolerar el "no" y no insistir.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "app-device-permissions", factory: "createPermissionsUnderTest", contractKind: "permissions-contract", behaviorKind: "permissions-behavior", fixtures: "permissions", param: "permissionsContract", harnessParams: (f) => ({ permissions: f.permissions }) };
const FACTS = { permissions: [{ id: "nearby-stores", kind: "location", fallback: "required" }, { id: "scan-receipt", kind: "camera", fallback: "required" }], hasHarness: true, harnessKind: "node-adapter" };

test("T29.2 la implementación correcta pasa los 6 escenarios por permiso", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 12);
});

const MATRIX = {
  "ask-on-launch": ["ask-in-context", "no-reprompt", "rationale"],
  "no-rationale": ["rationale"],
  "crash-on-deny": ["denied-fallback", "denied-keeps-working", "no-reprompt"],
  "no-fallback": ["denied-fallback"],
  reprompt: ["no-reprompt"],
  "ignore-blocked": ["no-reprompt", "settings-link"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T29.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T29.2 sin alternativa exigida, no ofrecerla no es incumplimiento", async () => {
  const r = await runControl(SPEC, "no-fallback", { ...FACTS, permissions: FACTS.permissions.map((p) => ({ ...p, fallback: "not-applicable" })) });
  assert.equal(r.result.decision, "allow");
});
