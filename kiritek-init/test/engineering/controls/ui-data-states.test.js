"use strict";

// T18: `ui.data-states` — cada defecto de la matriz cae en su regla; heurísticas no bloquean.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");

const SPEC = { slug: "ui-data-states", factory: "createScreenUnderTest", contractKind: "states-contract", behaviorKind: "states-behavior", fixtures: "data-states", param: "statesContract", harnessParams: (f) => ({ screens: f.screens }) };
const FACTS = { screens: [{ id: "orders", timeoutMs: 5000, emptyState: "required", retry: "required" }], hasHarness: true, harnessKind: "node-adapter" };

test("T18.2 la implementación correcta pasa todos los escenarios y la traza cumple el schema", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 7);
  assert.equal(validateAgainst("engineering/controls/ui-data-states.trace", trace, { extended: true }).valid, true);
});

const MATRIX = {
  "blank-loading": ["loading-announced", "loading-state"],
  "silent-loading": ["loading-announced"],
  "no-empty": ["empty-state"],
  "no-error": ["error-state", "retry", "retry-available", "timeout"],
  "no-timeout": ["timeout"],
  "no-retry": ["retry", "retry-available"],
  "double-fetch": ["duplicate-request", "retry"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T18.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
    assert.ok(r.result.findings.every((f) => f.evidenceClass === "deterministic" && f.path === "apps/x/contract.json"));
  });
}

test("T18.3 vacío y reintento no aplicables no se exigen", async () => {
  const facts = { ...FACTS, screens: [{ ...FACTS.screens[0], emptyState: "not-applicable", retry: "not-applicable" }] };
  const r = await runControl(SPEC, "no-empty", facts);
  assert.equal(r.result.decision, "allow");
  assert.ok(!r.trace.scenarios.some((s) => s.id.startsWith("retry@")));
});

test("T18.1 contrato: timeout por encima del máximo es determinista; sin contrato sólo avisa", () => {
  const contract = { kind: "states-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, screens: [{ ...FACTS.screens[0], timeoutMs: 90000 }] } } };
  const r = evaluateWith(SPEC, [contract], { params: { maxTimeoutMs: 30000 } });
  assert.equal(r.decision, "deny");
  assert.equal(r.findings[0].ruleId, "ui.data-states/contract-timeout");
  const heur = evaluateWith(SPEC, [{ kind: "states-contract", observationId: "c", facts: { declared: false, valid: false, errorCodes: [] } }, { kind: "states-signals", observationId: "s", evidenceClass: "heuristic", facts: { signals: [{ signal: "DATA_LOADING", path: "apps/x/a.ts" }] } }]);
  assert.equal(heur.decision, "warn");
  assert.ok(heur.findings.every((f) => f.evidenceClass === "heuristic"));
});

test("T18.3 adapter que no monta: escenarios en error (nunca deny); en agent la evidencia se difiere", async () => {
  const r = await runControl(SPEC, "throws", FACTS);
  assert.ok(r.trace.scenarios.every((s) => s.status === "error" && s.limitation === "ADAPTER_INIT_FAILED"));
  assert.equal(r.result.decision, "warn");
  const fast = evaluateWith(SPEC, [{ kind: "states-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: FACTS } }], { event: "agent" });
  assert.match(fast.reason, /BEHAVIOR_DEFERRED/);
});
