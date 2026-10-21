"use strict";

/** Casos de conformidad R27 de `svc.health-shutdown`. */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "svc.health-shutdown", livenessPath: "/livez", readinessPath: "/readyz", dependencies: ["db"], work: { method: "POST", path: "/reports" }, shutdownGraceMs: 10000, harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/health.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { healthContract: "apps/x/health.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "svc.health-shutdown",
  profiles: ["backend-service"],
  cases: [
    { id: "salud-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-dependencias", kind: "positive", ...withContract(contractDoc("ready-ignores-db", (d) => (d.dependencies = []))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("liveness-depende-de-la-base", "liveness-checks-db", ["liveness-independent"]),
    negative("readiness-ignora-la-base", "ready-ignores-db", ["readiness-checks-deps"]),
    negative("ready-durante-apagado", "ready-while-stopping", ["not-ready-on-shutdown"]),
    negative("acepta-durante-apagado", "accept-while-stopping", ["reject-new-work"]),
    negative("apagado-eterno", "no-grace-timeout", ["grace-period"]),
    { id: "gracia-excesiva", kind: "negative", ...withContract(contractDoc("good", (d) => (d.shutdownGraceMs = 120000))), expect: { decision: "warn", rules: ["contract-grace"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/server.ts": "app.listen(3000);\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
