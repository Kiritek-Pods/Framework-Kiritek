"use strict";

/** Casos de conformidad R27 de `api.idempotency`. */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.idempotency", endpoints: [{ id: "create-order", method: "POST", path: "/orders", keyHeader: "Idempotency-Key", requireKey: true, sampleBody: { sku: "k-sku-1", qty: 1 } }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/idempotency.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { idempotencyContract: "apps/x/idempotency.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.idempotency",
  profiles: ["http-api"],
  cases: [
    { id: "idempotencia-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "clave-opcional-declarada", kind: "positive", ...withContract(contractDoc("optional-key", (d) => (d.endpoints[0].requireKey = false))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("ejecuta-cada-vez", "no-store", ["concurrent-single-execution","key-mismatch","replay-same-response","single-execution"]),
    negative("carrera-duplica", "race-unsafe", ["concurrent-single-execution"]),
    negative("respuesta-distinta", "different-replay", ["replay-same-response"]),
    negative("misma-clave-otro-cuerpo", "ignore-body", ["key-mismatch"]),
    negative("sin-clave-obligatoria", "optional-key", ["key-required"]),
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "router.post('/orders', create);\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
