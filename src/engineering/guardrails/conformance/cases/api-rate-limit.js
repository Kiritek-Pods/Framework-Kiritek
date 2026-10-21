"use strict";

/** Casos de conformidad R27 de `api.rate-limit`. */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "api.rate-limit", limits: [{ id: "search", method: "GET", path: "/search", limit: 5, windowSeconds: 60, by: "api-key" }], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/rate-limit.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { rateLimitContract: "apps/x/rate-limit.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.rate-limit",
  profiles: ["http-api"],
  cases: [
    { id: "limite-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "por-ip", kind: "positive", ...withContract(contractDoc("good", (d) => (d.limits[0].by = "ip"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-limite", "no-limit", ["limit-enforced","retry-after"]),
    negative("corta-antes", "off-by-one", ["under-limit"]),
    negative("sin-retry-after", "no-retry-after", ["retry-after"]),
    negative("contador-global", "global", ["per-client"]),
    negative("ventana-eterna", "no-reset", ["window-reset"]),
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/app.ts": "const app = express();\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
