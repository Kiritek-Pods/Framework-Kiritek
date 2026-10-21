"use strict";

// T25: `analytics.events` — esquema, una vez, sin PII y sin romper la app si el envío falla.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { USER } = require("../../../src/engineering/guardrails/controls/analytics-events/harness.js");

const SPEC = { slug: "analytics-events", factory: "createTrackerUnderTest", contractKind: "analytics-plan", behaviorKind: "analytics-behavior", fixtures: "analytics", param: "trackingPlan", harnessParams: (f) => ({ events: f.events }) };
const EVENTS = [
  { name: "checkout.completed", properties: [{ name: "amount", type: "number", required: true }, { name: "currency", type: "string", required: true, enum: ["CLP", "USD"] }, { name: "coupon", type: "boolean", required: false }] },
  { name: "signup.started", properties: [{ name: "source", type: "string", required: false }] },
];
const FACTS = { events: EVENTS, hasHarness: true, harnessKind: "node-adapter" };

test("T25.2 la implementación correcta pasa; la traza no lleva payloads ni datos del usuario", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["schema#checkout.completed", "schema#signup.started", "no-pii", "transport-down"]);
  const text = JSON.stringify(trace);
  assert.ok(!text.includes(USER.email) && !text.includes("CLP"));
});

const MATRIX = {
  "skip-required": ["schema"],
  "wrong-types": ["schema"],
  "extra-props": ["unplanned-properties"],
  "leak-pii": ["pii-leak", "unplanned-properties"],
  "double-emit": ["duplicate-delivery", "emitted-once"],
  "throw-on-failure": ["failure-isolation"],
  "duplicate-on-retry": ["duplicate-delivery"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T25.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T25.1 plan: propiedades con nombre de dato personal son deterministas; la lista es configurable", () => {
  const plan = { ...FACTS, events: [{ name: "profile.saved", properties: [{ name: "user_email", type: "string", required: false }, { name: "plan", type: "string", required: false }] }] };
  const obs = [{ kind: "analytics-plan", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: plan } }];
  assert.equal(evaluateWith(SPEC, obs).findings[0].fingerprint, "ane:pii-property:profile.saved.user_email");
  assert.equal(evaluateWith(SPEC, obs, { params: { forbiddenProperties: ["plan"] } }).findings[0].fingerprint, "ane:pii-property:profile.saved.plan");
});
