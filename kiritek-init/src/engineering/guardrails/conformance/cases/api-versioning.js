"use strict";

/** Casos de conformidad R27 de `api.versioning` (T40.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "api.versioning",
    scheme: "path",
    versions: [
      { id: "v0", status: "retired" },
      { id: "v1", status: "deprecated", sunset: "2027-01-31", requiredFields: ["id", "total"] },
      { id: "v2", status: "supported", requiredFields: ["id", "total", "currency"] },
    ],
    endpoints: [{ id: "orders", path: "/orders" }],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/versioning.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { versioningContract: "apps/x/versioning.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "api.versioning",
  profiles: ["http-api"],
  cases: [
    { id: "versionado-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "version-en-header", kind: "positive", ...withContract(contractDoc("good-header", (d) => Object.assign(d, { scheme: "header", header: "api-version" }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("deprecada-sin-aviso", "no-deprecation", ["deprecation-header"]),
    negative("sin-fecha-de-retiro", "no-sunset", ["sunset-header"]),
    negative("fecha-de-retiro-distinta", "wrong-sunset", ["sunset-header"]),
    negative("todo-deprecado", "deprecate-all", ["false-deprecation"]),
    negative("version-inexistente-servida", "unknown-latest", ["unknown-version"]),
    negative("version-inexistente-500", "unknown-500", ["unknown-version"]),
    negative("retirada-servida", "retired-served", ["retired-version"]),
    negative("campo-renombrado", "breaking-v1", ["breaking-change"]),
    negative("version-quitada-antes", "v1-removed", ["breaking-change", "deprecation-header", "sunset-header", "version-served"]),
    { id: "sin-version-vigente", kind: "negative", ...withContract(contractDoc("good", (d) => (d.versions = d.versions.filter((v) => v.status !== "supported")))), expect: { decision: "warn", rules: ["contract-versions"], eligible: true } },
    { id: "retiro-vencido", kind: "negative", ...withContract(contractDoc("good", (d) => (d.versions[1].sunset = "2020-01-31"))), expect: { decision: "warn", rules: ["sunset-header", "sunset-passed"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/routes.ts": "app.use('/v1/orders', ordersV1);\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
