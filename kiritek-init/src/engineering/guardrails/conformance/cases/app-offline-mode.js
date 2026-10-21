"use strict";

/** Casos de conformidad R27 de `app.offline-mode` (T28.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "app.offline-mode",
    indicator: "required",
    actions: [
      { id: "save-note", queue: "required" },
      { id: "pay", queue: "online-only" },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/offline.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { offlineContract: "apps/x/offline.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "app.offline-mode",
  profiles: ["offline-capable"],
  cases: [
    { id: "offline-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-aviso-exigido", kind: "positive", ...withContract(contractDoc("no-notice", (d) => (d.indicator = "not-applicable"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-aviso", "no-notice", ["offline-indicator"]),
    negative("error-sin-red", "error-offline", ["offline-accept", "persist-queue", "sync-once", "sync-order"]),
    negative("nunca-sincroniza", "no-sync", ["persist-queue", "queue-drain", "sync-once", "sync-order"]),
    negative("envia-dos-veces", "double-send", ["persist-queue", "sync-once", "sync-order"]),
    negative("cola-que-no-se-vacia", "keep-after-sync", ["persist-queue", "queue-drain"]),
    negative("cola-en-memoria", "memory-only", ["persist-queue"]),
    negative("orden-invertido", "reverse-order", ["sync-order"]),
    negative("pago-falso-sin-red", "fake-success", ["online-only"]),
    negative("encola-pagos", "queue-everything", ["online-only"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/sw.ts": "navigator.serviceWorker.register('/sw.js');\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
