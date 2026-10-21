"use strict";

/** Casos de conformidad R27 de `api.batch` (T45.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.batch", endpoints: [{ id: "orders", path: "/orders/batch", mode: "partial", maxItems: 50, sampleItem: { sku: "k-1", qty: 1 }, invalidItem: { sku: "", qty: -1 } }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const atomic = (d) => (d.endpoints[0].mode = "atomic");
const withContract = (doc) => ({ files: { "apps/x/batch.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { batchContract: "apps/x/batch.json" } });
const negative = (id, adapter, rules, mutate) => ({ id, kind: "negative", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.batch",
  profiles: ["http-api"],
  cases: [
    { id: "parcial-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "todo-o-nada-correcto", kind: "positive", ...withContract(contractDoc("good-atomic", atomic)), expect: { decision: "allow", rules: [], eligible: false } },
    negative("se-detiene-en-el-error", "stop-on-error", ["partial-lost", "silent-failure"]),
    negative("oculta-el-error", "hide-errors", ["silent-failure"]),
    negative("un-error-tira-todo", "fail-whole", ["partial-lost", "silent-failure"]),
    negative("resultados-desordenados", "reversed", ["batch-results"]),
    negative("sin-tope", "no-limit", ["batch-limit"]),
    negative("vacio-500", "empty-500", ["empty-batch"]),
    negative("todo-o-nada-sin-transaccion", "no-rollback", ["not-atomic"], atomic),
    negative("parcial-declarado-atomico", "good", ["not-atomic", "silent-failure"], atomic),
    { id: "tope-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.endpoints[0].maxItems = 5000))), expect: { decision: "warn", rules: ["contract-batch-size"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "await prisma.order.createMany({ data: req.body.items });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
