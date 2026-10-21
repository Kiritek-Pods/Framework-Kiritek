"use strict";

// Adapter de referencia de api.long-operations (throws): no se puede crear
// POST /reports inicia un reporte; GET /operations/:id informa { status: running | succeeded | failed }. Máximo 60 s.
const OPTS = {"throws":true};
const MAX_MS = 60000;

exports.createApiUnderTest = ({ clock, deps }) => {
  throw new Error("api no disponible");
  const ops = new Map();
  let seq = 0;
  const run = (op, input) => {
    const ctrl = new AbortController();
    const timer = OPTS.noTimeout ? null : clock.setTimeout(() => {
      if (op.status !== "running") return;
      op.status = "failed";
      op.error = { code: "timeout" };
      if (!OPTS.noCancel) ctrl.abort();
    }, MAX_MS);
    return deps.work({ input, signal: ctrl.signal }).then(
      () => {
        if (timer) clock.clearTimeout(timer);
        if (op.status === "running" && !OPTS.neverFinishes) op.status = "succeeded";
      },
      (err) => {
        if (timer) clock.clearTimeout(timer);
        if (op.status !== "running") return;
        op.status = OPTS.swallowFailure ? "succeeded" : "failed";
        op.error = OPTS.leakError ? { code: "worker_error", message: err.message, stack: err.stack } : { code: "worker_error" };
      }
    );
  };
  return {
    async handle(req) {
      if (req.method === "POST" && req.path === "/reports") {
        const op = { id: `kop-${++seq}`, status: "running" };
        ops.set(op.id, op);
        if (OPTS.sync) {
          await run(op, req.body);
          return { status: 200, body: op };
        }
        run(op, req.body);
        return { status: 202, headers: OPTS.noLocation ? {} : { Location: `/operations/${op.id}` }, body: { id: op.id, status: op.status } };
      }
      const m = /^\/operations\/([\w-]+)$/.exec(req.path);
      if (req.method === "GET" && m) {
        const op = ops.get(m[1]);
        if (!op) {
          if (OPTS.unknown500) throw new Error("operación inexistente");
          return OPTS.unknown200 ? { status: 200, body: { status: "running" } } : { status: 404, body: { code: "not_found" } };
        }
        return { status: 200, body: { id: op.id, status: op.status, ...(op.error ? { error: op.error } : {}) } };
      }
      return { status: 404, body: { code: "not_found" } };
    },
  };
};
