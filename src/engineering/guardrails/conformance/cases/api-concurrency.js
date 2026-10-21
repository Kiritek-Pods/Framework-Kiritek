"use strict";

/** Casos de conformidad R27 de `api.concurrency` (T39.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.concurrency", resources: [{ id: "orders", path: "/orders/:id", mode: "etag" }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/concurrency.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { concurrencyContract: "apps/x/concurrency.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.concurrency",
  profiles: ["http-api"],
  cases: [
    { id: "etag-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "campo-de-version", kind: "positive", ...withContract(contractDoc("good-version-field", (d) => Object.assign(d.resources[0], { mode: "version-field", versionField: "version", method: "PATCH" }))), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "precondicion-opcional-declarada", kind: "positive", ...withContract(contractDoc("optional-precondition", (d) => (d.resources[0].requirePrecondition = false))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-version", "no-etag", ["atomic-check", "conditional-update", "stale-rejected", "version-advances", "version-exposed"]),
    negative("ultima-escritura-gana", "last-write-wins", ["atomic-check", "lost-update", "precondition-required", "stale-rejected"]),
    negative("leer-y-guardar", "check-then-save", ["atomic-check"]),
    negative("precondicion-opcional", "optional-precondition", ["precondition-required"]),
    negative("version-que-no-cambia", "no-bump", ["atomic-check", "lost-update", "stale-rejected", "version-advances"]),
    negative("conflicto-500", "conflict-500", ["stale-rejected"]),
    negative("rechaza-todo", "reject-all", ["atomic-check", "conditional-update", "version-advances"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "ruta-sin-id", kind: "negative", ...withContract(contractDoc("good", (d) => (d.resources[0].path = "/orders"))), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "router.put('/orders/:id', async (req) => repo.update(req.params.id, req.body));\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
