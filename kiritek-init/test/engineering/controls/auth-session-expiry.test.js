"use strict";

// T22: `auth.session-expiry` — renovación única, sin bucles, login y trabajo conservado.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { DRAFT } = require("../../../src/engineering/guardrails/controls/auth-session-expiry/harness.js");

const SPEC = { slug: "auth-session-expiry", factory: "createSessionUnderTest", contractKind: "session-contract", behaviorKind: "session-behavior", fixtures: "session", param: "sessionContract", harnessParams: (f) => ({ session: f.session }) };
const FACTS = { session: { refresh: "token-refresh", preserveWork: "required" }, hasHarness: true, harnessKind: "node-adapter" };

test("T22.2 la implementación correcta pasa; la traza no lleva tokens ni el borrador", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["valid", "expired-refresh", "concurrent", "refresh-fails", "repeated-401"]);
  const text = JSON.stringify(trace);
  assert.ok(!text.includes(DRAFT) && !/"t\d"/.test(text));
});

const MATRIX = {
  "no-refresh": ["no-loop", "refresh-retry", "single-refresh"],
  "refresh-per-request": ["single-refresh"],
  loop: ["no-loop"],
  "error-screen": ["login-redirect"],
  "drop-draft": ["preserve-work"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T22.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T22.2 sin renovación declarada: un 401 lleva al login; conservar trabajo es opcional si no se exige", async () => {
  const none = { ...FACTS, session: { refresh: "none", preserveWork: "not-applicable" } };
  const r = await runControl(SPEC, "drop-draft", none);
  assert.deepEqual(r.trace.scenarios.map((s) => s.id), ["valid", "no-refresh"]);
  assert.equal(r.result.decision, "allow");
});

test("T22.1 requireRefresh exige renovación en el contrato", () => {
  const obs = [{ kind: "session-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, session: { refresh: "none", preserveWork: "required" } } } }];
  assert.equal(evaluateWith(SPEC, obs, { params: { requireRefresh: true } }).findings[0].ruleId, "auth.session-expiry/contract-refresh");
});
