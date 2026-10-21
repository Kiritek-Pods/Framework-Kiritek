"use strict";

/** Casos de conformidad R27 de `app.minimum-supported-version` (T16.1). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "app.minimum-supported-version",
    versionScheme: "semver",
    environments: { production: { source: { kind: "remote-config", authenticity: "signature", keyId: "policy-k1" }, cacheTtlSeconds: 21600, staleIfOfflineSeconds: 86400, timeoutMs: 3000 } },
    offline: { firstRun: "allow-with-warning", expiredCache: "allow-with-warning" },
    grace: { allowed: true, timeSource: "server", maxDays: 14, audience: "all" },
    hard: { explainReason: true, exitWhenStoreUnavailable: "fallback-link" },
    soft: { allowContinue: true, postponeFrequencyHours: 24 },
    stores: [
      { platform: "ios", store: "app-store", fallback: "web-download" },
      { platform: "android", store: "play-store", fallback: "web-download" },
    ],
    rollback: { mechanism: "remote-policy-revert", requiresAppRelease: false },
    override: { authenticated: true, scopedBy: ["environment", "audience"], maxDurationHours: 24, audited: true, reversible: true },
    observability: { events: ["fetch", "parse", "cache", "decision", "store", "override"], identifiers: "pseudonymous" },
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/version-policy.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { policyContract: "apps/x/version-policy.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "app.minimum-supported-version",
  profiles: ["mobile-app"],
  cases: [
    { id: "politica-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "tokens-descartados", kind: "positive", ...withContract(contractDoc("leaky")), expect: { decision: "allow", rules: [], eligible: false } },
    negative("comparacion-lexicografica", "lexicographic", ["version-comparison"]),
    negative("gracia-con-reloj-local", "local-clock", ["grace"]),
    negative("payload-no-confiable", "trust-payload", ["untrusted-payload"]),
    negative("sin-timeout", "no-timeout", ["timeout"]),
    negative("usuario-atrapado", "trap-user", ["store-fallback"]),
    negative("ignora-overrides", "ignore-overrides", ["override"]),
    { id: "contrato-ilegible", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "fuente-sin-autenticidad", kind: "negative", ...withContract(contractDoc("good", (d) => (d.environments.production.source.authenticity = "none"))), expect: { decision: "warn", rules: ["contract-source-authenticity"], eligible: true } },
    { id: "rollback-exige-publicar", kind: "negative", ...withContract(contractDoc("good", (d) => (d.environments.production.source.kind = "bundled"))), expect: { decision: "warn", rules: ["contract-rollback"], eligible: true } },
    { id: "sin-contrato-heuristica", kind: "edge", files: { "apps/x/lib/gate.dart": "final forceUpdate = remoteConfig.getString('min_supported');\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
