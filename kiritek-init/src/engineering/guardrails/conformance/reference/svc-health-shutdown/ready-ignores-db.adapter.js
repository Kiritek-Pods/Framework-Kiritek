"use strict";

// Adapter de referencia de svc.health-shutdown (ready-ignores-db): readiness no revisa la base
// /livez, /readyz (revisa "db"), POST /reports (trabajo lento); gracia 10 s.
const OPTS = {"readyIgnoresDb":true};

exports.createServiceUnderTest = ({ clock, deps }) => {
  
  let stopping = false;
  const inFlight = new Set();
  return {
    async handle(req) {
      if (req.path === "/livez") {
        if (OPTS.livenessChecksDb) {
          try {
            await deps.db.ping();
          } catch (_) {
            return { status: 503, body: { status: "down" } };
          }
        }
        return { status: 200, body: { status: "ok" } };
      }
      if (req.path === "/readyz") {
        if (stopping && !OPTS.readyWhileStopping) return { status: 503, body: { status: "stopping" } };
        if (!OPTS.readyIgnoresDb) {
          try {
            await deps.db.ping();
          } catch (_) {
            return { status: 503, body: { status: "not-ready" } };
          }
        }
        return { status: 200, body: { status: "ready" } };
      }
      if (stopping && !OPTS.acceptWhileStopping) return { status: 503, headers: { Connection: "close" }, body: { code: "shutting_down" } };
      const job = deps.work();
      inFlight.add(job);
      try {
        await job;
        return { status: 201, body: { ok: true } };
      } finally {
        inFlight.delete(job);
      }
    },
    async shutdown() {
      stopping = true;
      if (OPTS.abortInFlight) {
        inFlight.clear();
        throw new Error("cortado");
      }
      const drain = Promise.allSettled([...inFlight]);
      if (OPTS.noGraceTimeout) return drain;
      await Promise.race([drain, new Promise((r) => clock.setTimeout(r, 10000))]);
    },
  };
};
