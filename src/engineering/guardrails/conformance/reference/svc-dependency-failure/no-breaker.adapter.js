"use strict";

// Adapter de referencia de svc.dependency-failure (no-breaker): sigue llamando a la base caída
// GET /catalog usa la base "db" (timeout 1000 ms, breaker tras 5 fallas, 30 s abierto).
const OPTS = {"noBreaker":true};

exports.createServiceUnderTest = ({ clock, deps }) => {
  
  let failures = 0;
  let openUntil = 0;
  const withTimeout = (p, ms) =>
    OPTS.noTimeout
      ? p
      : new Promise((resolve, reject) => {
          const t = clock.setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), ms);
          p.then((v) => (clock.clearTimeout(t), resolve(v)), (e) => (clock.clearTimeout(t), reject(e)));
        });
  return {
    async handle() {
      if (!OPTS.noBreaker && clock.now() < openUntil) return { status: 503, headers: { "Retry-After": "30" }, body: { code: "unavailable" } };
      try {
        await withTimeout(deps.db.call({}), 1000);
        failures = 0;
        if (OPTS.neverClose && openUntil) return { status: 503, body: { code: "unavailable" } };
        return { status: 200, body: { items: [] } };
      } catch (err) {
        failures += 1;
        if (failures >= 5) openUntil = clock.now() + 30000;
        if (OPTS.throwOnError) throw err;
        if (OPTS.status500) return { status: 500, body: { code: "error" } };
        return { status: 503, body: { code: "unavailable" } };
      }
    },
  };
};
