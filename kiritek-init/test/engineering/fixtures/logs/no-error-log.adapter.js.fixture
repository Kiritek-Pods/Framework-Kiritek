"use strict";

// Adapter de referencia de svc.log-hygiene (no-error-log): no registra la falla de la dependencia
// Servidor mínimo con logger JSON (estilo pino) y redacción de campos sensibles.
const OPTS = {"noErrorLog":true};
const REDACT = ["email", "phone", "cardNumber", "password", "authorization", "cookie"];

exports.createServiceUnderTest = ({ deps, logger }) => {
  
  let seq = 0;
  const clean = (obj) => {
    if (OPTS.noRedaction || !obj || typeof obj !== "object") return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = REDACT.includes(k) ? "[redacted]" : v;
    return out;
  };
  const log = (level, msg, extra, reqId) => {
    const id = OPTS.idPerLine ? `gen-${++seq}` : reqId;
    if (OPTS.plainText) return logger.write(`${level.toUpperCase()} ${msg} ${JSON.stringify(extra)}\n`);
    logger.write(JSON.stringify({ level, msg, requestId: OPTS.noCorrelation ? undefined : id, ...extra }) + "\n");
  };
  return {
    async handle(req) {
      const reqId = (!OPTS.ignoreHeader && req.headers["x-request-id"]) || `gen-${++seq}`;
      log("info", "request", { method: req.method, path: req.path, ...(OPTS.logHeaders ? { headers: req.headers } : {}), ...(OPTS.logBody ? { body: clean(req.body) } : {}), ...(OPTS.logQuery ? { query: req.query } : {}) }, reqId);
      try {
        await deps.dependency();
      } catch (err) {
        if (!OPTS.noErrorLog) log("error", OPTS.rawErrorMessage ? err.message : "dependency failed", { code: err.code }, reqId);
        return { status: 503, body: { code: "unavailable" } };
      }
      log("info", "response", { status: 201 }, reqId);
      return { status: 201, body: { id: "x-1" } };
    },
  };
};
