"use strict";

/** Casos de conformidad R27 de `api.pagination`. */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.pagination", collections: [{ id: "orders", path: "/orders", mode: "cursor", defaultPageSize: 20, maxPageSize: 100 }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/pagination.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { paginationContract: "apps/x/pagination.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.pagination",
  profiles: ["http-api"],
  cases: [
    { id: "paginacion-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "campos-explicitos", kind: "positive", ...withContract(contractDoc("good", (d) => Object.assign(d.collections[0], { itemsField: "items", cursorField: "nextCursor", limitParam: "limit", cursorParam: "cursor" }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("tamano-por-defecto-distinto", "wrong-default", ["default-page-size"]),
    negative("sin-tope", "no-max", ["max-page-size"]),
    negative("limit-invalido-500", "crash-bad-limit", ["invalid-limit"]),
    negative("cursor-que-es-offset", "offset-cursor", ["invalid-cursor","stable-cursor"]),
    negative("cursor-invalido-aceptado", "lenient-cursor", ["invalid-cursor"]),
    negative("repite-items", "overlap", ["duplicates","order","stable-cursor"]),
    negative("sin-final", "no-end", ["end-detection"]),
    negative("orden-inestable", "shuffle", ["order"]),
    { id: "tope-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.collections[0].maxPageSize = 900))), expect: { decision: "warn", rules: ["contract-page-size"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "const rows = await prisma.order.findMany({ take: 20 });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
