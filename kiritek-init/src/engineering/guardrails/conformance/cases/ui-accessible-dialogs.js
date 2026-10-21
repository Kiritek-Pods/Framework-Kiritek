"use strict";

/** Casos de conformidad R27 de `ui.accessible-dialogs` (T31.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "ui.accessible-dialogs",
    dialogs: [
      { id: "confirm-delete", kind: "modal", dismissible: false },
      { id: "filters", kind: "drawer", dismissible: true },
      { id: "account-menu", kind: "menu", dismissible: true },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/dialogs.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { dialogsContract: "apps/x/dialogs.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "ui.accessible-dialogs",
  profiles: ["dialogs"],
  cases: [
    { id: "dialogos-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "modal-descartable", kind: "positive", ...withContract(contractDoc("escape-always", (d) => (d.dialogs[0].dismissible = true))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("foco-no-entra", "no-focus-in", ["focus-in", "focus-trap"]),
    negative("foco-se-escapa", "no-trap", ["focus-trap"]),
    negative("escape-no-cierra", "no-escape", ["escape-close", "focus-return"]),
    negative("foco-perdido-al-cerrar", "no-focus-return", ["focus-return"]),
    negative("cierra-lo-no-descartable", "escape-always", ["escape-close"]),
    negative("rol-incorrecto", "wrong-role", ["role"]),
    negative("sin-nombre", "unlabelled", ["accessible-name"]),
    negative("fondo-activo", "live-background", ["background-inert"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/modal.tsx": "export const M = () => <div role=\"dialog\" />;\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
