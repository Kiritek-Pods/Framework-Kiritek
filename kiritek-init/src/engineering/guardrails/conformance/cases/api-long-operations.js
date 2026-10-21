"use strict";

/** Casos de conformidad R27 de `api.long-operations` (T44.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.long-operations", operations: [{ id: "report", path: "/reports", statusPath: "/operations/:id", sampleBody: { month: "2026-05" }, maxDurationMs: 60000 }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/operations.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { operationsContract: "apps/x/operations.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.long-operations",
  profiles: ["http-api"],
  cases: [
    { id: "operacion-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "valores-explicitos", kind: "positive", ...withContract(contractDoc("good", (d) => Object.assign(d.operations[0], { method: "POST", statusField: "status", doneValue: "succeeded", failedValue: "failed" }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("cliente-esperando", "sync", ["failure-not-reported", "never-completes", "not-async", "status-location", "stuck-forever"]),
    negative("sin-url-de-estado", "no-location", ["failure-not-reported", "never-completes", "status-location", "stuck-forever"]),
    negative("estado-que-no-termina", "never-finishes", ["never-completes"]),
    negative("falla-marcada-exitosa", "swallow-failure", ["failure-not-reported"]),
    negative("error-interno-expuesto", "leak-error", ["failure-leak"]),
    negative("en-proceso-para-siempre", "no-timeout", ["stuck-forever"]),
    negative("timeout-sin-cancelar", "no-cancel", ["not-cancelled"]),
    negative("inexistente-200", "unknown-200", ["unknown-operation"]),
    negative("inexistente-500", "unknown-500", ["unknown-operation"]),
    { id: "duracion-excesiva", kind: "negative", ...withContract(contractDoc("good", (d) => (d.operations[0].maxDurationMs = 7200000))), expect: { decision: "warn", rules: ["contract-duration"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/reports.ts": "res.status(202).json({ jobId });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
