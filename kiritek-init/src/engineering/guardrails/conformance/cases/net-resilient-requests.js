"use strict";

/** Casos de conformidad R27 de `net.resilient-requests` (T20.4). */

const OPERATIONS = [
  { id: "list-orders", idempotent: true, timeoutMs: 2000, idempotencyKey: "none", retry: { maxAttempts: 3, backoff: "exponential", baseMs: 200, maxDelayMs: 2000, on: ["429", "5xx", "network", "timeout"] } },
  { id: "create-payment", idempotent: false, timeoutMs: 5000, idempotencyKey: "header", retry: { maxAttempts: 3, backoff: "exponential", baseMs: 300, on: ["5xx", "network", "timeout"] } },
  { id: "send-message", idempotent: false, timeoutMs: 3000, idempotencyKey: "none", retry: { maxAttempts: 2, backoff: "fixed", baseMs: 500, on: ["5xx"] } },
];

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "net.resilient-requests", operations: JSON.parse(JSON.stringify(OPERATIONS)), harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/client.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { clientContract: "apps/x/client.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "net.resilient-requests",
  profiles: ["network-client"],
  cases: [
    { id: "cliente-correcto", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "backoff-fijo", kind: "positive", ...withContract(contractDoc("good", (d) => (d.operations[0].retry.backoff = "fixed"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-timeout", "no-timeout", ["timeout"]),
    negative("reintenta-4xx", "retry-4xx", ["client-error-retry"]),
    negative("nunca-reintenta", "no-retry", ["backoff", "retry-after", "retry-limit", "transient-retry"]),
    negative("reintentos-infinitos", "infinite-retry", ["backoff", "retry-limit", "timeout"]),
    negative("sin-espera", "no-backoff", ["backoff"]),
    negative("ignora-retry-after", "ignore-retry-after", ["retry-after"]),
    negative("duplica-operaciones", "unsafe-retry", ["idempotency"]),
    negative("clave-cambia", "new-key-per-attempt", ["idempotency"]),
    { id: "reintento-inseguro-declarado", kind: "negative", ...withContract(contractDoc("good", (d) => d.operations[2].retry.on.push("network"))), expect: { decision: "warn", rules: ["contract-unsafe-retry"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/api.ts": "export const get = () => fetch('/api/orders');\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
