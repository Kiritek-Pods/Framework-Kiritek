"use strict";

/** Casos de conformidad R27 de `ui.destructive-actions` (T26.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "ui.destructive-actions",
    actions: [
      { id: "delete-account", safeguard: "confirm" },
      { id: "archive-note", safeguard: "undo", undoWindowMs: 5000 },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/actions.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { actionsContract: "apps/x/actions.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "ui.destructive-actions",
  profiles: ["destructive-actions"],
  cases: [
    { id: "acciones-correctas", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "confirmar-y-deshacer", kind: "positive", ...withContract(contractDoc("good", (d) => (d.actions[0] = { id: "delete-account", safeguard: "confirm-and-undo", undoWindowMs: 4000 }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("ejecuta-al-primer-clic", "no-confirm", ["confirmation", "dismiss"]),
    negative("cancelar-ejecuta", "dismiss-executes", ["dismiss"]),
    negative("ejecucion-doble", "double-run", ["double-execution"]),
    negative("deshacer-no-funciona", "no-undo", ["undo"]),
    negative("nunca-se-aplica", "undo-never-executes", ["double-execution", "error-state", "execute", "message-text", "undo-window"]),
    negative("error-como-exito", "silent-failure", ["error-state"]),
    negative("mensajes-con-claves", "raw-keys", ["message-text"]),
    { id: "ventana-muy-corta", kind: "negative", ...withContract(contractDoc("good", (d) => (d.actions[1].undoWindowMs = 500))), expect: { decision: "warn", rules: ["contract-undo-window"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/account.ts": "export const remove = () => api.deleteAccount(id);\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
