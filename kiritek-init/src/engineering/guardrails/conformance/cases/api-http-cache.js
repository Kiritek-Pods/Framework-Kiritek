"use strict";

/** Casos de conformidad R27 de `api.http-cache` (T42.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "api.http-cache",
    resources: [
      { id: "product", path: "/products/kp-1", visibility: "public", maxAgeSeconds: 300 },
      { id: "cart", path: "/me/cart", visibility: "private" },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const lastModified = (d) => d.resources.forEach((r) => (r.validator = "last-modified"));
const withContract = (doc) => ({ files: { "apps/x/cache.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { cacheContract: "apps/x/cache.json" } });
const negative = (id, adapter, rules, mutate) => ({ id, kind: "negative", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.http-cache",
  profiles: ["http-api"],
  cases: [
    { id: "cache-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "last-modified", kind: "positive", ...withContract(contractDoc("good", lastModified)), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-cache-control", "no-cache-control", ["cache-control-missing"]),
    negative("max-age-distinto", "wrong-max-age", ["max-age"]),
    negative("privado-en-cache-compartida", "private-public", ["private-cacheable"]),
    negative("sin-validador", "no-validator", ["conditional-get", "validator-missing"]),
    negative("nunca-304", "never-304", ["conditional-get"]),
    negative("304-con-cuerpo", "body-304", ["not-modified-body"]),
    negative("etag-fijo", "static-etag", ["cross-user-validator", "stale-validator"]),
    negative("etag-compartido-entre-usuarios", "shared-etag", ["cross-user-validator"]),
    negative("ignora-if-modified-since", "ignores-ims", ["conditional-get"], lastModified),
    { id: "max-age-excesivo", kind: "negative", ...withContract(contractDoc("good", (d) => (d.resources[0].maxAgeSeconds = 31536000))), parameters: { cacheContract: "apps/x/cache.json", maxAgeLimitSeconds: 86400 }, expect: { decision: "warn", rules: ["contract-max-age", "max-age"], eligible: true } },
    { id: "publico-sin-max-age", kind: "negative", ...withContract(contractDoc("good", (d) => delete d.resources[0].maxAgeSeconds)), expect: { decision: "warn", rules: ["contract-max-age", "max-age"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/products.ts": "res.set('Cache-Control', 'public, max-age=300');\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
