"use strict";

/** Casos de conformidad R27 de `svc.dependency-failure`. */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "svc.dependency-failure", endpoint: { method: "GET", path: "/catalog" }, dependencies: [{ id: "db", kind: "database", timeoutMs: 1000, circuitBreaker: "required", degraded: "not-applicable" }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/dependencies.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { dependencyContract: "apps/x/dependencies.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "svc.dependency-failure",
  profiles: ["backend-service"],
  cases: [
    { id: "dependencias-correctas", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-breaker-exigido", kind: "positive", ...withContract(contractDoc("no-breaker", (d) => (d.dependencies[0].circuitBreaker = "not-applicable"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-timeout", "no-timeout", ["dependency-timeout","failure-response"]),
    negative("excepcion-propagada", "throw-on-error", ["failure-response"]),
    negative("error-500", "status-500", ["failure-response"]),
    negative("sin-breaker", "no-breaker", ["circuit-breaker"]),
    negative("breaker-no-cierra", "never-close", ["breaker-recovery"]),
    { id: "timeout-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.dependencies[0].timeoutMs = 60000))), expect: { decision: "warn", rules: ["contract-timeout"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/db.ts": "export const pool = new Pool();\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
