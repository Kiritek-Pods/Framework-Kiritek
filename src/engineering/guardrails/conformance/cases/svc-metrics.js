"use strict";

/** Casos de conformidad R27 de `svc.metrics` (T48.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "svc.metrics", names: { requests: "http_requests_total", duration: "http_request_duration_seconds" }, endpoints: [{ id: "get-user", method: "GET", route: "/users/:id" }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/metrics.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { metricsContract: "apps/x/metrics.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "svc.metrics",
  profiles: ["backend-service"],
  cases: [
    { id: "metricas-correctas", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "nombres-explicitos", kind: "positive", ...withContract(contractDoc("good", (d) => Object.assign(d, { metricsPath: "/metrics", labels: { route: "route", method: "method", status: "status" } }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-metricas", "no-metrics", ["error-count", "latency-histogram", "metrics-endpoint", "request-count"]),
    negative("url-concreta-como-label", "raw-path", ["error-count", "high-cardinality", "latency-histogram", "request-count"]),
    negative("errores-sin-contar", "skip-errors", ["error-count"]),
    negative("status-siempre-200", "always-ok", ["error-count"]),
    negative("sin-histograma", "no-histogram", ["latency-histogram", "metrics-endpoint"]),
    negative("latencia-con-reloj-del-sistema", "wall-clock", ["latency-histogram"]),
    negative("email-como-label", "user-label", ["pii-in-labels"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/metrics.ts": "import client from 'prom-client';\nconst h = new client.Histogram({ name: 'x' });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
