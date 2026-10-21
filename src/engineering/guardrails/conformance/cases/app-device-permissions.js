"use strict";

/** Casos de conformidad R27 de `app.device-permissions` (T29.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "app.device-permissions",
    permissions: [
      { id: "scan-receipt", kind: "camera", fallback: "required" },
      { id: "nearby-stores", kind: "location", fallback: "required" },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/permissions.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { permissionsContract: "apps/x/permissions.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "app.device-permissions",
  profiles: ["device-permissions"],
  cases: [
    { id: "permisos-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-alternativa-exigida", kind: "positive", ...withContract(contractDoc("no-fallback", (d) => d.permissions.forEach((p) => (p.fallback = "not-applicable")))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("pide-al-abrir", "ask-on-launch", ["ask-in-context", "no-reprompt", "rationale"]),
    negative("pide-sin-explicar", "no-rationale", ["rationale"]),
    negative("error-al-negar", "crash-on-deny", ["denied-fallback", "denied-keeps-working", "no-reprompt"]),
    negative("sin-alternativa", "no-fallback", ["denied-fallback"]),
    negative("insiste", "reprompt", ["no-reprompt"]),
    negative("ignora-bloqueo", "ignore-blocked", ["no-reprompt", "settings-link"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/scan.ts": "await navigator.mediaDevices.getUserMedia({ video: true });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
