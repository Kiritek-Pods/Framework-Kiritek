"use strict";

// T42: `api.http-cache` — Cache-Control por visibilidad, validadores, 304 y ETag por usuario.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/api-http-cache/contract.js");
const { directives } = require("../../../src/engineering/guardrails/controls/api-http-cache/harness.js");

const SPEC = { slug: "api-http-cache", factory: "createApiUnderTest", contractKind: "cache-contract", behaviorKind: "cache-behavior", fixtures: "cache", param: "cacheContract", harnessParams: (f) => ({ resources: f.resources }) };
const facts = (validator) =>
  factsOf({
    resources: [
      { id: "product", path: "/products/kp-1", visibility: "public", maxAgeSeconds: 300, ...(validator ? { validator } : {}) },
      { id: "cart", path: "/me/cart", visibility: "private", ...(validator ? { validator } : {}) },
    ],
    harness: { kind: "node-adapter", adapter: "x" },
  });
const FACTS = facts();

test("T42.2 la implementación correcta pasa (ETag y Last-Modified) y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 9);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  const lm = await runControl(SPEC, "good", facts("last-modified"));
  assert.equal(lm.result.decision, "allow", JSON.stringify(lm.result));
});

test("T42.2 Cache-Control se interpreta por directivas", () => {
  assert.deepEqual(directives('public, max-age="300", s-maxage=60'), { public: true, "max-age": "300", "s-maxage": "60" });
});

const MATRIX = {
  "no-cache-control": ["cache-control-missing"],
  "wrong-max-age": ["max-age"],
  "private-public": ["private-cacheable"],
  "no-validator": ["conditional-get", "validator-missing"],
  "never-304": ["conditional-get"],
  "body-304": ["not-modified-body"],
  "static-etag": ["cross-user-validator", "stale-validator"],
  "shared-etag": ["cross-user-validator"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T42.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T42.3 ignores-ims: con Last-Modified, ignorar If-Modified-Since es determinista", async () => {
  const r = await runControl(SPEC, "ignores-ims", facts("last-modified"));
  assert.equal(r.result.decision, "deny");
  assert.deepEqual(r.rules, ["conditional-get"]);
});
