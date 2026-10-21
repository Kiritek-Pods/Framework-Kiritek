"use strict";

/**
 * Escenarios de `net.resilient-requests` (T20.2). El transporte del harness
 * responde por plan (status, error de red o nunca); `random` es fijo (0.5)
 * para que el jitter sea determinista.
 */

const MAX_OPERATIONS = 5;
const RESPONSE_MS = 10;

const retryable = (op) => op.idempotent || op.idempotencyKey === "header";
const retriesOn = (op, kind) => op.retry.maxAttempts >= 2 && op.retry.on.includes(kind);

function scenariosFor(op) {
  const r = retryable(op);
  return [
    "timeout",
    "client-error",
    r && retriesOn(op, "5xx") && "transient",
    r && retriesOn(op, "network") && "network",
    r && op.retry.on.includes("5xx") && "retry-limit",
    r && op.retry.on.includes("5xx") && op.retry.maxAttempts >= 3 && "backoff",
    r && retriesOn(op, "429") && "retry-after",
    !op.idempotent && "ambiguous",
  ].filter(Boolean);
}

/** Plan del transporte: la última respuesta se repite. */
function planFor(scenario, op) {
  switch (scenario) {
    case "timeout":
      return [{ hang: true }];
    case "client-error":
      return [{ status: 400 }];
    case "transient":
      return [...(op.retry.maxAttempts >= 3 ? [{ status: 503 }, { status: 503 }] : [{ status: 503 }]), { status: 200 }];
    case "network":
      return [{ network: true }, { status: 200 }];
    case "retry-limit":
    case "backoff":
      return [{ status: 503 }];
    case "retry-after":
      return [{ status: 429, retryAfterSeconds: 3 }, { status: 200 }];
    case "ambiguous":
      return [{ network: true }, { status: 200 }];
    default:
      return [{ status: 200 }];
  }
}

/** Máximo esperable de espera entre intentos (para acotar el tiempo virtual). */
function maxDelay(op) {
  const r = op.retry;
  const exp = r.backoff === "exponential" ? r.baseMs * 2 ** Math.max(0, r.maxAttempts - 2) : r.baseMs;
  return r.maxDelayMs !== undefined ? Math.min(exp, r.maxDelayMs) : exp;
}

/** Tiempo virtual máximo para que una llamada termine. */
function settleLimit(op) {
  return op.retry.maxAttempts * (op.timeoutMs + maxDelay(op) + RESPONSE_MS) + 5000;
}

const split = (id) => {
  const [scenario, op] = id.split("@");
  return { scenario, op };
};

function requiredScenarios(facts) {
  return facts.operations.slice(0, MAX_OPERATIONS).flatMap((o) => scenariosFor(o).map((s) => `${s}@${o.id}`));
}

function expectationsFor(id, params) {
  const { scenario, op: opId } = split(id);
  const op = (params.operations || []).find((o) => o.id === opId);
  if (!op) return [];
  const r = op.retry;
  switch (scenario) {
    case "timeout":
      return [{ settled: true, attempts: (v) => v >= 1 && v <= r.maxAttempts }];
    case "client-error":
      return [{ settled: true, ok: false, attempts: 1 }];
    case "transient":
      return [{ settled: true, ok: true, attempts: planFor("transient", op).length }];
    case "network":
      return [{ settled: true, ok: true, attempts: 2 }];
    case "retry-limit":
      return [{ settled: true, ok: false, attempts: r.maxAttempts }];
    case "backoff":
      return [
        {
          settled: true,
          gaps: (g) =>
            Array.isArray(g) &&
            g.length >= 2 &&
            g.every((x) => x >= Math.floor(r.baseMs * 0.5)) &&
            (r.maxDelayMs === undefined || g.every((x) => x <= r.maxDelayMs + 2 * RESPONSE_MS)) &&
            (r.backoff === "fixed" || (r.maxDelayMs !== undefined && g[g.length - 1] >= r.maxDelayMs) || g[g.length - 1] > g[0]),
        },
      ];
    case "retry-after":
      return [{ settled: true, ok: true, attempts: 2, gaps: (g) => Array.isArray(g) && g[0] >= 3000 }];
    case "ambiguous":
      return [{ settled: true, attempts: (v, step) => v === 1 || (op.idempotencyKey === "header" && step.sameKey === true && step.keyed === true) }];
    default:
      return [];
  }
}

const RULES = {
  timeout: "timeout",
  "client-error": "client-error-retry",
  transient: "transient-retry",
  network: "transient-retry",
  "retry-limit": "retry-limit",
  backoff: "backoff",
  "retry-after": "retry-after",
  ambiguous: "idempotency",
};
const ruleFor = (id) => RULES[split(id).scenario];

module.exports = { MAX_OPERATIONS, RESPONSE_MS, retryable, scenariosFor, planFor, settleLimit, requiredScenarios, expectationsFor, ruleFor, split };
