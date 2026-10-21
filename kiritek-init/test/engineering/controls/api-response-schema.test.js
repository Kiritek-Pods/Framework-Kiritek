"use strict";

// T43: `api.response-schema` — las respuestas reales cumplen el schema publicado, sin campos sin documentar.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-response-schema/contract.js");
const { unsupported, undeclared } = require("../../../src/engineering/guardrails/controls/api-response-schema/schema-subset.js");
const CASES = require("../../../src/engineering/guardrails/conformance/cases/api-response-schema.js");

const SPEC = { slug: "api-response-schema", factory: "createApiUnderTest", contractKind: "respschema-contract", behaviorKind: "respschema-behavior", fixtures: "respschema", param: "responseSchemaContract", harnessParams: (f) => ({ errorSchema: f.errorSchema, endpoints: f.endpoints }) };
const docOf = (caseId) => JSON.parse(CASES.cases.find((c) => c.id === caseId).files["apps/x/response-schemas.json"]);
const FACTS = factsOf(docOf("respuestas-que-cumplen"));

test("T43.2 la implementación correcta pasa y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 2);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
});

test("T43.2 subconjunto verificable y campos no declarados", () => {
  assert.deepEqual(unsupported({ type: "object", properties: { a: { oneOf: [] }, b: { $ref: "otro.json#/x" } } }), ["$.properties.a.oneOf", "$.properties.b.$ref"]);
  assert.deepEqual(unsupported({ type: "string", format: "date-time", description: "x" }), []);
  const s = { type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } };
  assert.equal(undeclared({ a: { b: "x", c: 1 }, d: 2 }, s), 2);
  assert.equal(undeclared({ a: { b: "x" } }, s), 0);
});

test("T43.3 un schema con palabras clave no verificables es determinista", () => {
  const doc = docOf("schema-no-verificable");
  const r = evaluateWith(SPEC, [{ kind: "respschema-contract", observationId: "obs/c", facts: { declared: true, valid: true, errorCodes: [], contract: factsOf(doc) } }]);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ["api.response-schema/contract-schema-unsupported"]);
});

const MATRIX = {
  "string-amount": ["schema-mismatch"],
  "missing-required": ["schema-mismatch"],
  "bad-enum": ["schema-mismatch"],
  "null-note": ["schema-mismatch"],
  "wrong-status": ["response-status"],
  "plain-error": ["error-schema"],
  "error-500": ["error-schema", "error-status"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T43.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T43.3 extra-field: con un schema permisivo el campo sin documentar se detecta igual", async () => {
  const r = await runControl(SPEC, "extra-field", factsOf(docOf("campo-interno-expuesto")));
  assert.equal(r.result.decision, "deny");
  assert.deepEqual(r.rules, ["undeclared-field"]);
});
