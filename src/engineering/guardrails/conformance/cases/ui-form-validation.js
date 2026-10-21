"use strict";

/** Casos de conformidad R27 de `ui.form-validation` (T19.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "ui.form-validation",
    forms: [
      {
        id: "signup",
        fields: [
          { name: "email", required: true, format: "email" },
          { name: "name", required: true, format: "text", minLength: 2, maxLength: 40 },
          { name: "age", required: false, format: "number" },
        ],
      },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/forms.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { formsContract: "apps/x/forms.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "ui.form-validation",
  profiles: ["forms"],
  cases: [
    { id: "formulario-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-obligatorios", kind: "positive", ...withContract(contractDoc("good", (d) => d.forms[0].fields.forEach((f) => (f.required = false)))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("envia-sin-validar", "no-validation", ["blocks-invalid-submit", "error-linked", "focus-first-invalid", "format", "message-text", "required"]),
    negative("sin-validar-formato", "lax-format", ["blocks-invalid-submit", "error-linked", "format", "message-text"]),
    negative("error-no-asociado", "unlinked", ["error-linked"]),
    negative("foco-no-se-mueve", "no-focus", ["focus-first-invalid"]),
    negative("claves-internas", "raw-keys", ["message-text"]),
    negative("doble-envio", "double-submit", ["double-submit"]),
    negative("borra-lo-escrito", "reset-on-error", ["preserve-input", "resubmit"]),
    negative("error-silencioso", "silent-error", ["error-announced"]),
    negative("error-pegado", "sticky-errors", ["error-clears"]),
    { id: "largos-incoherentes", kind: "negative", ...withContract(contractDoc("good", (d) => Object.assign(d.forms[0].fields[2], { minLength: 50, maxLength: 10 }))), expect: { decision: "warn", rules: ["contract-length"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/signup.tsx": "export const F = () => <form onSubmit={send} />;\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
