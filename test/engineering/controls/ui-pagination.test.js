"use strict";

// T24: `ui.pagination` — páginas, duplicados, orden, fin de lista, concurrencia, errores y cursor estable.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "ui-pagination", factory: "createListUnderTest", contractKind: "lists-contract", behaviorKind: "lists-behavior", fixtures: "lists", param: "listsContract", harnessParams: (f) => ({ lists: f.lists }) };
const LIST = { id: "orders", pageSize: 10, mode: "cursor", endState: "required" };
const FACTS = { lists: [LIST], hasHarness: true, harnessKind: "node-adapter" };

test("T24.2 la implementación correcta pasa; la traza no lleva ids de ítems", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 6);
  assert.ok(!JSON.stringify(trace).includes("item-"));
});

test("T24.2 detectar el fin con una página vacía extra se tolera", async () => {
  assert.equal((await runControl(SPEC, "empty-page-end", FACTS)).result.decision, "allow");
});

const MATRIX = {
  "wrong-limit": ["error-state", "first-page", "keep-on-error", "page-size", "retry"],
  "no-end": ["end-state", "extra-requests", "load-after-end"],
  "ignore-end": ["load-after-end"],
  concurrent: ["concurrent-load"],
  "clear-on-error": ["keep-on-error", "retry"],
  "silent-error": ["error-state"],
  "offset-always": ["stable-cursor"],
  reverse: ["order"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T24.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T24.2 en modo offset no se exige cursor estable; páginas gigantes son deterministas", async () => {
  const r = await runControl(SPEC, "offset-always", { ...FACTS, lists: [{ ...LIST, mode: "offset" }] });
  assert.ok(!r.trace.scenarios.some((s) => s.id.startsWith("shifting")));
  assert.equal(r.result.decision, "allow");
  const obs = [{ kind: "lists-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, lists: [{ ...LIST, pageSize: 400 }] } } }];
  assert.equal(evaluateWith(SPEC, obs).findings[0].fingerprint, "upg:contract-page-size:orders");
});
