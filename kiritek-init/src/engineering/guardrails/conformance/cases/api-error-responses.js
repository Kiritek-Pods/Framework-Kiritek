"use strict";

/** Casos de conformidad R27 de `api.error-responses`. */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.error-responses", errorFormat: "problem+json", endpoints: [{ id: "create-order", method: "POST", path: "/orders", sampleBody: { sku: "k-sku-1", qty: 1 }, invalidBodies: [{ sku: 7 }, { sku: "k", qty: -1 }] }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/errors.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { errorsContract: "apps/x/errors.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.error-responses",
  profiles: ["http-api"],
  cases: [
    { id: "errores-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "un-solo-invalido", kind: "positive", ...withContract(contractDoc("good", (d) => (d.endpoints[0].invalidBodies = [{}]))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("no-valida", "no-validation", ["error-format","validation-status"]),
    negative("json-roto-500", "crash-on-malformed", ["error-format","malformed-body"]),
    negative("expone-stack", "leak-stack", ["no-internal-details"]),
    negative("texto-plano", "plain-errors", ["error-format"]),
    negative("ruta-inexistente-200", "not-found-200", ["error-format","not-found-status"]),
    { id: "formato-custom-sin-campos", kind: "negative", ...withContract(contractDoc("good", (d) => (d.errorFormat = "custom"))), expect: { decision: "warn", rules: ["contract-error-fields"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/app.ts": "const app = express();\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
