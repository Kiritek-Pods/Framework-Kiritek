"use strict";

/** Casos de conformidad R27 de `api.request-limits` (T41.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.request-limits", maxBodyBytes: 65536, timeoutMs: 2000, endpoints: [{ id: "create-order", method: "POST", path: "/orders", sampleBody: { sku: "k-1", qty: 1 } }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/limits.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { limitsContract: "apps/x/limits.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.request-limits",
  profiles: ["http-api"],
  cases: [
    { id: "limites-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "listado-sin-cuerpo", kind: "positive", ...withContract(contractDoc("good", (d) => (d.endpoints[0] = { id: "list-orders", method: "GET", path: "/orders" }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-limite-de-cuerpo", "no-body-limit", ["body-limit", "body-limit-status", "body-limit-unverified", "processed-oversized"]),
    negative("confia-en-content-length", "trusts-header", ["body-limit-unverified", "processed-oversized"]),
    negative("excedido-con-400", "limit-400", ["body-limit-status"]),
    negative("procesa-y-despues-rechaza", "process-then-reject", ["processed-oversized"]),
    negative("limite-menor-al-declarado", "tiny-limit", ["false-rejection"]),
    negative("sin-timeout", "no-timeout", ["request-timeout"]),
    negative("timeout-con-200", "timeout-200", ["timeout-status"]),
    negative("timeout-con-500", "timeout-500", ["timeout-status"]),
    negative("timeout-sin-cancelar", "no-cancel", ["cancel-on-timeout"]),
    negative("corta-antes-de-tiempo", "premature", ["premature-timeout"]),
    { id: "timeout-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.timeoutMs = 90000))), expect: { decision: "warn", rules: ["contract-limits", "premature-timeout"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/server.ts": "app.use(express.json({ limit: '64kb' }));\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
