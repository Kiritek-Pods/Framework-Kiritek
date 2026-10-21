"use strict";

/** Casos de conformidad R27 de `svc.startup-config` (T49.4). */

const VARIABLES = [
  { name: "DATABASE_URL", kind: "url" },
  { name: "API_TOKEN", kind: "secret" },
  { name: "REGION", kind: "string" },
  { name: "PORT", kind: "int", required: false },
  { name: "LOG_LEVEL", kind: "enum", required: false, values: ["debug", "info", "warn", "error"] },
];
function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "svc.startup-config", variables: JSON.parse(JSON.stringify(VARIABLES)), harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/config.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { startupConfigContract: "apps/x/config.json" } });
const negative = (id, adapter, rules, mutate) => ({ id, kind: "negative", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "svc.startup-config",
  profiles: ["backend-service"],
  cases: [
    { id: "configuracion-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "ejemplo-propio", kind: "positive", ...withContract(contractDoc("good", (d) => (d.variables[0].example = "postgres://app@db.kiritek.test/app"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("falla-recien-en-la-primera-request", "lazy", ["invalid-not-detected", "missing-not-detected"]),
    negative("sin-validar-formato", "no-validation", ["invalid-not-detected"]),
    negative("error-que-no-dice-cual", "vague-error", ["unhelpful-error"]),
    negative("imprime-el-entorno", "dump-env", ["secret-in-config-error"]),
    negative("exige-una-opcional", "port-required", ["optional-required"]),
    negative("opcional-declarada-obligatoria", "good", ["missing-not-detected"], (d) => (d.variables[3].required = true)),
    negative("enum-sin-valores", "good", ["contract-enum-values", "optional-required", "valid-config-rejected"], (d) => delete d.variables[4].values),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/config.ts": "export const db = process.env.DATABASE_URL;\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-no-carga", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
