"use strict";

/** Casos de conformidad R27 de `ui.data-states` (T18.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "ui.data-states",
    screens: [{ id: "orders", timeoutMs: 5000, emptyState: "required", retry: "required" }],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/states.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { statesContract: "apps/x/states.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "ui.data-states",
  profiles: ["data-views"],
  cases: [
    { id: "estados-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "vacio-no-aplica", kind: "positive", ...withContract(contractDoc("no-empty", (d) => (d.screens[0].emptyState = "not-applicable"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("pantalla-en-blanco", "blank-loading", ["loading-announced", "loading-state"]),
    negative("carga-no-anunciada", "silent-loading", ["loading-announced"]),
    negative("sin-estado-vacio", "no-empty", ["empty-state"]),
    negative("error-carga-infinita", "no-error", ["error-state", "retry", "retry-available", "timeout"]),
    negative("sin-timeout", "no-timeout", ["timeout"]),
    negative("sin-reintento", "no-retry", ["retry", "retry-available"]),
    negative("pedidos-duplicados", "double-fetch", ["duplicate-request", "retry"]),
    { id: "timeout-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.screens[0].timeoutMs = 90000))), expect: { decision: "warn", rules: ["contract-timeout"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "export const load = () => fetch('/api/orders');\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
