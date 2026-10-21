"use strict";

/** Casos de conformidad R27 de `svc.log-hygiene` (T38.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "svc.log-hygiene",
    correlationHeader: "x-request-id",
    fields: { level: "level", message: "msg", requestId: "requestId" },
    endpoints: [{ id: "create-user", method: "POST", path: "/users", sampleBody: { plan: "pro" } }],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/logs.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { logsContract: "apps/x/logs.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "svc.log-hygiene",
  profiles: ["backend-service"],
  cases: [
    { id: "logs-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "get-sin-cuerpo", kind: "positive", ...withContract(contractDoc("good", (d) => (d.endpoints[0] = { id: "list-users", method: "GET", path: "/users" }))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("texto-plano", "plain-text", ["correlation-generated", "correlation-propagated", "structured-logs"]),
    negative("sin-correlacion", "no-correlation", ["correlation-generated", "correlation-propagated"]),
    negative("ignora-el-header", "ignore-header", ["correlation-propagated"]),
    negative("id-por-linea", "id-per-line", ["correlation-generated", "correlation-propagated"]),
    negative("cuerpo-sin-redactar", "log-body", ["pii-in-logs", "secret-in-logs"]),
    negative("headers-con-token", "log-headers", ["secret-in-logs"]),
    negative("query-con-email", "log-query", ["pii-in-logs"]),
    negative("falla-sin-log", "no-error-log", ["error-logged"]),
    negative("mensaje-de-error-crudo", "raw-error-message", ["pii-in-logs", "secret-in-logs"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/server.ts": "logger.info({ user }, 'login');\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
