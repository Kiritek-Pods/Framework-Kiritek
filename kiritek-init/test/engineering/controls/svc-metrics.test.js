"use strict";

// T48: `svc.metrics` — tráfico, errores y latencia por ruta, sin cardinalidad explosiva ni datos del usuario.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const { factsOf } = require("../../../src/engineering/guardrails/controls/svc-metrics/contract.js");
const { parse, sum } = require("../../../src/engineering/guardrails/controls/svc-metrics/prometheus.js");

const SPEC = { slug: "svc-metrics", factory: "createServiceUnderTest", contractKind: "metrics-contract", behaviorKind: "metrics-behavior", fixtures: "metrics", param: "metricsContract", harnessParams: (f) => ({ metricsPath: f.metricsPath, names: f.names, labels: f.labels, endpoints: f.endpoints }) };
const FACTS = factsOf({ names: { requests: "http_requests_total", duration: "http_request_duration_seconds" }, endpoints: [{ id: "get-user", method: "GET", route: "/users/:id" }], harness: { kind: "node-adapter", adapter: "x" } });

test("T48.2 la implementación correcta pasa y la traza sólo lleva booleanos", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 5);
  assert.equal(validateAgainst("engineering/controls/facts.trace", trace, { extended: true }).valid, true);
  assert.ok(!JSON.stringify(trace).includes("kcanary"));
});

test("T48.2 lectura del formato Prometheus", () => {
  const m = parse('# TYPE x counter\nx{route="/a",status="200"} 3\nx{route="/a",status="503"} 2\nh_bucket{le="+Inf"} 1\n');
  assert.equal(m.types.x, "counter");
  assert.equal(sum(m, "x", { route: "/a" }), 5);
  assert.equal(sum(m, "x", { status: (v) => v.startsWith("5") }), 2);
  assert.equal(parse("no es { prometheus"), null);
});

const MATRIX = {
  "no-metrics": ["error-count", "latency-histogram", "metrics-endpoint", "request-count"],
  "raw-path": ["error-count", "high-cardinality", "latency-histogram", "request-count"],
  "skip-errors": ["error-count"],
  "always-ok": ["error-count"],
  "no-histogram": ["latency-histogram", "metrics-endpoint"],
  "wall-clock": ["latency-histogram"],
  "user-label": ["pii-in-labels"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T48.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}
