"use strict";

/** Casos de conformidad R27 de `ui.pagination` (T24.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "ui.pagination", lists: [{ id: "orders", pageSize: 10, mode: "cursor", endState: "required" }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/lists.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { listsContract: "apps/x/lists.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "ui.pagination",
  profiles: ["paginated-lists"],
  cases: [
    { id: "paginacion-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "fin-por-pagina-vacia", kind: "positive", ...withContract(contractDoc("empty-page-end")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "offset-declarado", kind: "positive", ...withContract(contractDoc("good", (d) => (d.lists[0].mode = "offset"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("pide-de-mas", "wrong-limit", ["error-state", "first-page", "keep-on-error", "page-size", "retry"]),
    negative("sin-fin-de-lista", "no-end", ["end-state", "extra-requests", "load-after-end"]),
    negative("pide-despues-del-fin", "ignore-end", ["load-after-end"]),
    negative("cargas-simultaneas", "concurrent", ["concurrent-load"]),
    negative("borra-al-fallar", "clear-on-error", ["keep-on-error", "retry"]),
    negative("error-silencioso", "silent-error", ["error-state"]),
    negative("offset-con-cursor-declarado", "offset-always", ["stable-cursor"]),
    negative("orden-incorrecto", "reverse", ["order"]),
    { id: "pagina-gigante", kind: "negative", ...withContract(contractDoc("good", (d) => (d.lists[0].pageSize = 400))), expect: { decision: "warn", rules: ["contract-page-size"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "const q = useInfiniteQuery({ getNextPageParam: (p) => p.nextCursor });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
