"use strict";

// T20: `net.resilient-requests` — timeouts, reintentos, backoff e idempotencia con reloj virtual.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "net-resilient-requests", factory: "createClientUnderTest", contractKind: "requests-contract", behaviorKind: "requests-behavior", fixtures: "requests", param: "clientContract", harnessParams: (f) => ({ operations: f.operations }) };
const OPS = [
  { id: "list-orders", idempotent: true, timeoutMs: 2000, idempotencyKey: "none", retry: { maxAttempts: 3, backoff: "exponential", baseMs: 200, maxDelayMs: 2000, on: ["429", "5xx", "network", "timeout"] } },
  { id: "create-payment", idempotent: false, timeoutMs: 5000, idempotencyKey: "header", retry: { maxAttempts: 3, backoff: "exponential", baseMs: 300, on: ["5xx", "network", "timeout"] } },
  { id: "send-message", idempotent: false, timeoutMs: 3000, idempotencyKey: "none", retry: { maxAttempts: 2, backoff: "fixed", baseMs: 500, on: ["5xx"] } },
];
const FACTS = { operations: OPS, hasHarness: true, harnessKind: "node-adapter" };

test("T20.2 la implementación correcta pasa; la operación no idempotente sin clave nunca se reintenta tras error ambiguo", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  const amb = trace.scenarios.find((s) => s.id === "ambiguous@send-message");
  assert.equal(amb.steps[0].attempts, 1);
  const keyed = trace.scenarios.find((s) => s.id === "ambiguous@create-payment");
  assert.equal(keyed.steps[0].sameKey, true);
  const backoff = trace.scenarios.find((s) => s.id === "backoff@list-orders").steps[0].gaps;
  assert.ok(backoff[1] > backoff[0], `backoff creciente: ${backoff}`);
  assert.ok(!JSON.stringify(trace).includes("k-1"), "la clave de idempotencia no sale en la traza");
});

const MATRIX = {
  "no-timeout": ["timeout"],
  "retry-4xx": ["client-error-retry"],
  "no-retry": ["backoff", "retry-after", "retry-limit", "transient-retry"],
  "infinite-retry": ["backoff", "retry-limit", "timeout"],
  "no-backoff": ["backoff"],
  "ignore-retry-after": ["retry-after"],
  "unsafe-retry": ["idempotency"],
  "new-key-per-attempt": ["idempotency"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T20.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T20.1 contrato: reintento inseguro, timeout, intentos y backoff incoherente son deterministas", () => {
  const ops = [
    { ...OPS[2], retry: { ...OPS[2].retry, on: ["network"] } },
    { ...OPS[0], id: "slow", timeoutMs: 90000 },
    { ...OPS[0], id: "many", retry: { ...OPS[0].retry, maxAttempts: 9 } },
    { ...OPS[0], id: "odd", retry: { ...OPS[0].retry, baseMs: 5000, maxDelayMs: 1000 } },
  ];
  const r = evaluateWith(SPEC, [{ kind: "requests-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, operations: ops } } }], { params: { maxTimeoutMs: 30000, maxAttempts: 5 } });
  assert.deepEqual(r.findings.map((f) => f.fingerprint).sort(), ["nrr:contract-attempts:many", "nrr:contract-backoff:odd", "nrr:contract-timeout:slow", "nrr:contract-unsafe-retry:send-message"]);
});
