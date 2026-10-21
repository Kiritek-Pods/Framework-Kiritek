"use strict";

// T19: `ui.form-validation` — validación, errores accesibles y envío; sin valores en la traza.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { validValue, invalidValue } = require("../../../src/engineering/guardrails/controls/ui-form-validation/scenarios.js");

const SPEC = { slug: "ui-form-validation", factory: "createFormUnderTest", contractKind: "forms-contract", behaviorKind: "forms-behavior", fixtures: "forms", param: "formsContract", harnessParams: (f) => ({ forms: f.forms }) };
const FIELDS = [
  { name: "email", required: true, format: "email" },
  { name: "name", required: true, format: "text", minLength: 2, maxLength: 40 },
  { name: "age", required: false, format: "number" },
];
const FACTS = { forms: [{ id: "signup", fields: FIELDS }], hasHarness: true, harnessKind: "node-adapter" };

test("T19.2 la implementación correcta pasa y la traza no lleva valores ingresados", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 6);
  const text = JSON.stringify(trace);
  for (const f of FIELDS) {
    assert.ok(!text.includes(validValue(f)), `valor válido de ${f.name} en la traza`);
    if (invalidValue(f)) assert.ok(!text.includes(invalidValue(f)), `valor inválido de ${f.name} en la traza`);
  }
});

const MATRIX = {
  "no-validation": ["blocks-invalid-submit", "error-linked", "focus-first-invalid", "format", "message-text", "required"],
  "lax-format": ["blocks-invalid-submit", "error-linked", "format", "message-text"],
  unlinked: ["error-linked"],
  "no-focus": ["focus-first-invalid"],
  "raw-keys": ["message-text"],
  "double-submit": ["double-submit"],
  "reset-on-error": ["preserve-input", "resubmit"],
  "silent-error": ["error-announced"],
  "sticky-errors": ["error-clears"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T19.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T19.2 formularios sin obligatorios ni restricciones sólo prueban envío", async () => {
  const facts = { ...FACTS, forms: [{ id: "note", fields: [{ name: "body", required: false, format: "text" }] }] };
  const r = await runControl(SPEC, "good", facts);
  assert.deepEqual(r.trace.scenarios.map((s) => s.id), ["valid-submit@note", "double-submit@note", "server-error@note"]);
});

test("T19.1 contrato: largos incoherentes es determinista", () => {
  const facts = { ...FACTS, forms: [{ id: "signup", fields: [{ name: "bio", required: false, format: "text", minLength: 50, maxLength: 10 }] }] };
  const r = evaluateWith(SPEC, [{ kind: "forms-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: facts } }]);
  assert.equal(r.decision, "deny");
  assert.equal(r.findings[0].fingerprint, "ufv:contract-length:signup.bio");
});
