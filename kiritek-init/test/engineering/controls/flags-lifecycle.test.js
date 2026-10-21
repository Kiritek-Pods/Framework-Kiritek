"use strict";

// T21: `flags.lifecycle` — registro (dueño, retiro, defaults) y cliente frente a un proveedor sintético.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { harnessParams } = require("../../../src/engineering/guardrails/controls/flags-lifecycle/scenarios.js");

const SPEC = { slug: "flags-lifecycle", factory: "createFlagClientUnderTest", contractKind: "flags-registry", behaviorKind: "flags-behavior", fixtures: "flags", param: "flagRegistry", harnessParams };
const FLAGS = [
  { key: "new-checkout", owner: "team-pay", kind: "release", createdAt: "2026-09-01T00:00:00Z", removeBy: "2026-11-15T00:00:00Z", defaultValue: false, killSwitch: true },
  { key: "admin-panel", owner: "team-core", kind: "permission", createdAt: "2026-01-01T00:00:00Z", removeBy: null, defaultValue: false, killSwitch: false },
];
const FACTS = { flags: FLAGS, client: { timeoutMs: 800, refreshSeconds: 60 }, hasHarness: true, harnessKind: "node-adapter" };
const registry = (facts) => [{ kind: "flags-registry", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: facts } }];

test("T21.2 el cliente correcto pasa los seis escenarios", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.status), Array(6).fill("ok"));
});

const MATRIX = {
  "throws-on-down": ["fallback-default", "timeout"],
  "no-timeout": ["timeout"],
  "trust-garbage": ["invalid-value"],
  "unknown-throws": ["unknown-flag"],
  "no-refresh": ["propagation"],
  "ignore-provider": ["propagation", "provider-value"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T21.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T21.1 registro: vencida, sin retiro, vida excesiva, permiso abierto y kill switch no booleano", () => {
  const flags = [
    { ...FLAGS[0], key: "old", removeBy: "2026-10-01T00:00:00Z" },
    { ...FLAGS[0], key: "forever", removeBy: null, killSwitch: false },
    { ...FLAGS[0], key: "long", removeBy: "2027-09-01T00:00:00Z", killSwitch: false },
    { ...FLAGS[1], key: "open", defaultValue: true },
    { key: "variant", owner: "x", kind: "ops", createdAt: "2026-01-01T00:00:00Z", removeBy: null, defaultValue: "a", killSwitch: true },
  ];
  const r = evaluateWith(SPEC, registry({ ...FACTS, client: null, flags }));
  assert.equal(r.decision, "deny");
  assert.deepEqual(r.findings.map((f) => f.fingerprint).sort(), ["ffl:flag-expired:old", "ffl:flag-lifetime:long", "ffl:kill-switch-type:variant", "ffl:remove-by-missing:forever", "ffl:unsafe-default:open"]);
});

test("T21.1 sin cliente sólo se evalúa el registro; vencimientos próximos avisan sin bloquear", () => {
  const soon = [{ ...FLAGS[0], removeBy: "2026-10-10T00:00:00Z" }];
  const r = evaluateWith(SPEC, registry({ ...FACTS, client: null, hasHarness: false, flags: soon }));
  assert.equal(r.decision, "allow");
  assert.match(r.reason, /1 flag\(s\) vencen/);
  const expired = evaluateWith(SPEC, registry({ ...FACTS, client: null, hasHarness: false, flags: soon }), { now: "2026-10-11T00:00:00.000Z" });
  assert.equal(expired.decision, "deny");
});
