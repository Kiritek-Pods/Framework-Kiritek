"use strict";

/** Casos de conformidad R27 de `ui.file-upload` (T23.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "ui.file-upload", uploads: [{ id: "avatar", maxBytes: 5242880, accept: ["image/jpeg", "image/png"], cancel: "required", retry: "required" }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc, parameters = {}) => ({ files: { "apps/x/uploads.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { uploadsContract: "apps/x/uploads.json", ...parameters } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "ui.file-upload",
  profiles: ["file-upload"],
  cases: [
    { id: "subida-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "comodin-de-imagen", kind: "positive", ...withContract(contractDoc("good", (d) => (d.uploads[0].accept = ["image/*"]))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-limite-de-tamano", "no-size-check", ["message-text", "size-limit"]),
    negative("sin-control-de-tipo", "no-type-check", ["message-text", "type-check"]),
    negative("rechazo-con-claves", "raw-keys", ["message-text"]),
    negative("sin-progreso", "no-progress", ["progress"]),
    negative("no-se-puede-cancelar", "no-cancel", ["cancel"]),
    negative("error-colgado", "no-error-state", ["error-state", "retry"]),
    negative("sin-reintento", "no-retry", ["retry"]),
    negative("subida-doble", "double-start", ["duplicate-upload"]),
    { id: "acepta-cualquier-tipo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.uploads[0].accept = ["*/*"]))), expect: { decision: "warn", rules: ["contract-accept-any"], eligible: true } },
    { id: "limite-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.uploads[0].maxBytes = 2147483648))), expect: { decision: "warn", rules: ["contract-size"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/avatar.tsx": "export const A = () => <input type=\"file\" />;\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
