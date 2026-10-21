"use strict";

// T38: `svc.log-hygiene` — logs estructurados, correlación y sin datos personales ni secretos.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { CANARY } = require("../../../src/engineering/guardrails/controls/svc-log-hygiene/harness.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/svc-log-hygiene/contract.js");

const SPEC = { slug: "svc-log-hygiene", factory: "createServiceUnderTest", contractKind: "logs-contract", behaviorKind: "logs-behavior", fixtures: "logs", param: "logsContract", harnessParams: (f) => ({ correlationHeader: f.correlationHeader, fields: f.fields, endpoints: f.endpoints }) };
const FACTS = factsOf({ correlationHeader: "x-request-id", fields: { level: "level", message: "msg", requestId: "requestId" }, endpoints: [{ id: "create-user", method: "POST", path: "/users", sampleBody: { plan: "pro" } }], harness: { kind: "node-adapter", adapter: "x" } });

test("T38.2 la implementación correcta pasa y la traza nunca lleva los canarios", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 4);
  const text = JSON.stringify(trace);
  for (const v of Object.values(CANARY)) assert.ok(!text.includes(v));
});

const MATRIX = {
  "plain-text": ["correlation-generated", "correlation-propagated", "structured-logs"],
  "no-correlation": ["correlation-generated", "correlation-propagated"],
  "ignore-header": ["correlation-propagated"],
  "id-per-line": ["correlation-generated", "correlation-propagated"],
  "log-body": ["pii-in-logs", "secret-in-logs"],
  "log-headers": ["secret-in-logs"],
  "log-query": ["pii-in-logs"],
  "no-error-log": ["error-logged"],
  "raw-error-message": ["pii-in-logs", "secret-in-logs"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T38.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
