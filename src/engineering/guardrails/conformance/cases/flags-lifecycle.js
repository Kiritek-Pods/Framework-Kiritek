"use strict";

/** Casos de conformidad R27 de `flags.lifecycle` (T21.4). Reloj de la suite: 2026-10-05. */

function registryDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "flags.lifecycle",
    flags: [
      { key: "new-checkout", owner: "team-pay", kind: "release", createdAt: "2026-09-01T00:00:00Z", removeBy: "2026-11-15T00:00:00Z", defaultValue: false, killSwitch: true },
      { key: "admin-panel", owner: "team-core", kind: "permission", createdAt: "2026-01-01T00:00:00Z", defaultValue: false },
      { key: "search-ranking", owner: "team-search", kind: "experiment", createdAt: "2026-09-20T00:00:00Z", removeBy: "2026-11-01T00:00:00Z", defaultValue: "control" },
    ],
    client: { timeoutMs: 800, refreshSeconds: 60 },
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withRegistry = (doc) => ({ files: { "apps/x/flags.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { flagRegistry: "apps/x/flags.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withRegistry(registryDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "flags.lifecycle",
  profiles: ["feature-flags"],
  cases: [
    { id: "flags-correctas", kind: "positive", ...withRegistry(registryDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "solo-registro", kind: "positive", ...withRegistry(registryDoc("good", (d) => (delete d.client, delete d.harness))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("lanza-si-proveedor-cae", "throws-on-down", ["fallback-default", "timeout"]),
    negative("espera-para-siempre", "no-timeout", ["timeout"]),
    negative("acepta-basura", "trust-garbage", ["invalid-value"]),
    negative("flag-desconocida-lanza", "unknown-throws", ["unknown-flag"]),
    negative("kill-switch-no-llega", "no-refresh", ["propagation"]),
    negative("ignora-proveedor", "ignore-provider", ["propagation", "provider-value"]),
    { id: "flag-vencida", kind: "negative", ...withRegistry(registryDoc("good", (d) => (d.flags[0].removeBy = "2026-10-01T00:00:00Z"))), expect: { decision: "warn", rules: ["flag-expired"], eligible: true } },
    { id: "sin-fecha-de-retiro", kind: "negative", ...withRegistry(registryDoc("good", (d) => delete d.flags[2].removeBy)), expect: { decision: "warn", rules: ["remove-by-missing"], eligible: true } },
    { id: "vida-excesiva", kind: "negative", ...withRegistry(registryDoc("good", (d) => (d.flags[0].removeBy = "2027-06-01T00:00:00Z"))), expect: { decision: "warn", rules: ["flag-lifetime"], eligible: true } },
    { id: "permiso-abierto-por-defecto", kind: "negative", ...withRegistry(registryDoc("good", (d) => (d.flags[1].defaultValue = true))), expect: { decision: "warn", rules: ["unsafe-default"], eligible: true } },
    { id: "registro-invalido", kind: "negative", ...withRegistry("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-registro-inferencia", kind: "edge", files: { "apps/x/src/checkout.ts": "if (client.isEnabled('new-checkout')) render();\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "cliente-sin-harness", kind: "edge", ...withRegistry(registryDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withRegistry(registryDoc("throws")), expect: { eligible: false } },
  ],
};
