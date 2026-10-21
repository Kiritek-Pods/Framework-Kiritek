"use strict";

/** Casos de conformidad R27 de `auth.session-expiry` (T22.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "auth.session-expiry", session: { refresh: "token-refresh", preserveWork: "required" }, harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc, parameters = {}) => ({ files: { "apps/x/session.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { sessionContract: "apps/x/session.json", ...parameters } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "auth.session-expiry",
  profiles: ["auth-session"],
  cases: [
    { id: "sesion-correcta", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-renovacion-declarada", kind: "positive", ...withContract(contractDoc("good", (d) => (d.session.refresh = "none"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("nunca-renueva", "no-refresh", ["no-loop", "refresh-retry", "single-refresh"]),
    negative("renueva-por-pedido", "refresh-per-request", ["single-refresh"]),
    negative("bucle-de-renovacion", "loop", ["no-loop"]),
    negative("error-en-vez-de-login", "error-screen", ["login-redirect"]),
    negative("pierde-el-trabajo", "drop-draft", ["preserve-work"]),
    { id: "renovacion-exigida", kind: "negative", ...withContract(contractDoc("good", (d) => (d.session.refresh = "none")), { requireRefresh: true }), expect: { decision: "warn", rules: ["contract-refresh"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/api.ts": "if (res.status === 401) await refreshToken();\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
