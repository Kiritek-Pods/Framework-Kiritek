"use strict";

// T40: `api.versioning` — versiones servidas, avisos Deprecation/Sunset, versiones desconocidas y retiradas, campos estables.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-versioning/contract.js");
const { sunsetDay } = require("../../../src/engineering/guardrails/controls/api-versioning/harness.js");

const SPEC = { slug: "api-versioning", factory: "createApiUnderTest", contractKind: "versioning-contract", behaviorKind: "versioning-behavior", fixtures: "versioning", param: "versioningContract", harnessParams: (f) => ({ scheme: f.scheme, header: f.header, versions: f.versions, endpoints: f.endpoints }) };
const VERSIONS = [
  { id: "v0", status: "retired" },
  { id: "v1", status: "deprecated", sunset: "2027-01-31", requiredFields: ["id", "total"] },
  { id: "v2", status: "supported", requiredFields: ["id", "total", "currency"] },
];
const facts = (extra = {}) => factsOf({ scheme: "path", versions: VERSIONS, endpoints: [{ id: "orders", path: "/orders" }], harness: { kind: "node-adapter", adapter: "x" }, ...extra });
const FACTS = facts();

test("T40.2 la implementación correcta pasa (ruta y header) y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  const h = await runControl(SPEC, "good-header", facts({ scheme: "header", header: "api-version" }));
  assert.equal(h.result.decision, "allow", JSON.stringify(h.result));
});

test("T40.2 Sunset se compara por día (HTTP-date)", () => {
  assert.equal(sunsetDay("Sun, 31 Jan 2027 00:00:00 GMT"), "2027-01-31");
  assert.equal(sunsetDay("mañana"), null);
});

test("T40.3 contrato sin versión vigente o con retiro vencido es determinista", () => {
  const obs = (f) => [{ kind: "versioning-contract", observationId: "obs/c", facts: { declared: true, valid: true, errorCodes: [], contract: f } }];
  const none = evaluateWith(SPEC, obs(factsOf({ scheme: "path", versions: [{ id: "v1", status: "deprecated" }], endpoints: [{ id: "o", path: "/o" }] })));
  assert.deepEqual(none.findings.map((f) => f.ruleId), ["api.versioning/contract-versions"]);
  const past = evaluateWith(SPEC, obs(factsOf({ scheme: "path", versions: [{ id: "v1", status: "deprecated", sunset: "2026-01-01" }, { id: "v2", status: "supported" }], endpoints: [{ id: "o", path: "/o" }] })), { now: "2026-10-05T12:00:00.000Z" });
  assert.deepEqual(past.findings.map((f) => f.ruleId), ["api.versioning/sunset-passed"]);
});

const MATRIX = {
  "no-deprecation": ["deprecation-header"],
  "no-sunset": ["sunset-header"],
  "wrong-sunset": ["sunset-header"],
  "deprecate-all": ["false-deprecation"],
  "unknown-latest": ["unknown-version"],
  "unknown-500": ["unknown-version"],
  "retired-served": ["retired-version"],
  "breaking-v1": ["breaking-change"],
  "v1-removed": ["breaking-change", "deprecation-header", "sunset-header", "version-served"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T40.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
