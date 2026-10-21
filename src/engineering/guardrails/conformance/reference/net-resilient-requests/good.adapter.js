"use strict";

// Adapter de referencia de net.resilient-requests (good): implementación correcta
const OPTS = {};

exports.createClientUnderTest = ({ clock, transport, random, operations }) => {
  
  const sleep = (ms) => new Promise((resolve) => clock.setTimeout(resolve, ms));
  let seq = 0;
  const once = (op, headers) =>
    new Promise((resolve, reject) => {
      const timer = OPTS.noTimeout ? null : clock.setTimeout(() => reject(Object.assign(new Error("timeout"), { kind: "timeout" })), op.timeoutMs);
      transport.send({ operation: op.id, headers }).then(
        (res) => {
          if (timer !== null) clock.clearTimeout(timer);
          resolve(res);
        },
        () => {
          if (timer !== null) clock.clearTimeout(timer);
          reject(Object.assign(new Error("network"), { kind: "network" }));
        }
      );
    });
  return {
    async call(operationId) {
      const op = operations.find((o) => o.id === operationId);
      const r = op.retry;
      const max = OPTS.infiniteRetry ? 20 : OPTS.noRetry ? 1 : r.maxAttempts;
      const keyed = op.idempotencyKey === "header";
      let key = keyed ? `k-${++seq}` : null;
      for (let attempt = 1; ; attempt += 1) {
        if (keyed && OPTS.newKeyPerAttempt) key = `k-${++seq}`;
        let kind;
        let retryAfterMs = 0;
        try {
          const res = await once(op, key ? { "Idempotency-Key": key } : {});
          if (res.status < 400) return res;
          if (res.status === 429) {
            kind = "429";
            retryAfterMs = Number((res.headers || {})["retry-after"] || 0) * 1000;
          } else if (res.status >= 500) kind = "5xx";
          else if (!OPTS.retry4xx) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
          else kind = "5xx";
        } catch (err) {
          if (err.final) throw err;
          kind = err.kind;
        }
        const ambiguous = kind === "network" || kind === "timeout";
        const safe = op.idempotent || keyed || !ambiguous || OPTS.unsafeRetry;
        if (attempt >= max || (!r.on.includes(kind) && !OPTS.retry4xx && !OPTS.infiniteRetry && !OPTS.unsafeRetry) || !safe) throw new Error("falló");
        let delay = OPTS.noBackoff ? 0 : r.backoff === "exponential" ? r.baseMs * 2 ** (attempt - 1) : r.baseMs;
        if (r.maxDelayMs !== undefined) delay = Math.min(delay, r.maxDelayMs);
        delay = Math.round(delay * (0.5 + random() / 2));
        if (kind === "429" && !OPTS.ignoreRetryAfter) delay = Math.max(delay, retryAfterMs);
        await sleep(delay);
      }
    },
  };
};
