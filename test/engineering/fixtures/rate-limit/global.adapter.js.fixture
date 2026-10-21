"use strict";

// Adapter de referencia de api.rate-limit (global): un solo contador para todos los clientes
// Ventana fija por cliente: GET /search, 5 pedidos cada 60 s por api-key.
const OPTS = {"global":true};
const LIMIT = 5;
const WINDOW_MS = 60000;

exports.createApiUnderTest = ({ clock }) => {
  
  const buckets = new Map();
  let globalStart = null;
  return {
    async handle(req) {
      if (OPTS.noLimit) return { status: 200, body: { items: [] } };
      const who = OPTS.global ? "all" : req.headers["x-api-key"] || req.ip;
      const now = clock.now();
      let b = buckets.get(who);
      if (!b || (now - b.start >= WINDOW_MS && !OPTS.noReset)) {
        b = { start: now, count: 0 };
        buckets.set(who, b);
      }
      if (globalStart === null) globalStart = now;
      b.count += 1;
      if (b.count > (OPTS.offByOne ? LIMIT - 1 : LIMIT)) {
        const retry = Math.ceil((b.start + WINDOW_MS - now) / 1000);
        return { status: 429, headers: OPTS.noRetryAfter ? {} : { "Retry-After": String(Math.max(1, retry)) }, body: { code: "rate_limited" } };
      }
      return { status: 200, body: { items: [] } };
    },
  };
};
