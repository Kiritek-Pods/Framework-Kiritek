"use strict";

/** Casos de conformidad R27 de `data.user-erasure` (T47.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "data.user-erasure",
    erasure: { method: "DELETE", path: "/users/:userId" },
    stores: [{ id: "users" }, { id: "orders" }, { id: "events" }],
    readEndpoints: [{ id: "admin-list", path: "/admin/users" }],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/erasure.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { erasureContract: "apps/x/erasure.json" } });
const negative = (id, adapter, rules, mutate) => ({ id, kind: "negative", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "data.user-erasure",
  profiles: ["backend-service"],
  cases: [
    { id: "borrado-completo", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-lecturas-declaradas", kind: "positive", ...withContract(contractDoc("good", (d) => delete d.readEndpoints)), expect: { decision: "allow", rules: [], eligible: false } },
    negative("olvida-un-almacen", "forget-orders", ["erasure-incomplete"]),
    negative("borrado-logico", "soft-delete", ["erased-reappears", "erasure-incomplete"]),
    negative("anonimizacion-a-medias", "partial-anon", ["erasure-incomplete"]),
    negative("borra-datos-ajenos", "delete-everyone", ["collateral-deletion"]),
    negative("reaparece-en-cache", "stale-cache", ["erased-reappears"]),
    negative("repetir-da-500", "repeat-500", ["erasure-not-idempotent"]),
    negative("inexistente-da-500", "unknown-500", ["erasure-unknown-user"]),
    negative("inexistente-borra-ajenos", "unknown-deletes", ["erasure-unknown-user"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "ruta-sin-usuario", kind: "negative", ...withContract(contractDoc("good", (d) => (d.erasure.path = "/me"))), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/account.ts": "export async function deleteAccount(id) { await db.users.delete(id); }\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
