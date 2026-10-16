"use strict";

// Adapter de referencia de api.request-limits (tiny-limit): límite menor al declarado
// POST /orders con límite de cuerpo de 64 KiB y timeout de 2 s sobre deps.work.
const OPTS = {"tinyLimit":true};
const MAX_BODY = OPTS.tinyLimit ? 1024 : 65536;
const TIMEOUT_MS = OPTS.premature ? 200 : 2000;

exports.createApiUnderTest = ({ clock, deps }) => {
  
  const sizeOf = (req) => {
    const declared = req.headers["content-length"];
    if (declared !== undefined) return Number(declared);
    return OPTS.trustsHeader ? 0 : Buffer.byteLength(JSON.stringify(req.body === undefined ? null : req.body), "utf8");
  };
  const withTimeout = (fn) => {
    const ctrl = new AbortController();
    return new Promise((resolve, reject) => {
      const t = OPTS.noTimeout ? null : clock.setTimeout(() => {
        if (!OPTS.noCancel) ctrl.abort();
        reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      }, TIMEOUT_MS);
      fn(ctrl.signal).then((v) => { if (t) clock.clearTimeout(t); resolve(v); }, (err) => { if (t) clock.clearTimeout(t); reject(err); });
    });
  };
  return {
    async handle(req) {
      const tooBig = !OPTS.noBodyLimit && sizeOf(req) > MAX_BODY;
      if (tooBig && OPTS.processThenReject) await deps.work({});
      if (tooBig) return { status: OPTS.limit400 ? 400 : 413, body: { code: "payload_too_large" } };
      try {
        await withTimeout((signal) => deps.work({ signal }));
      } catch (err) {
        if (err.code !== "ETIMEDOUT") throw err;
        if (OPTS.timeout200) return { status: 200, body: { partial: true } };
        return { status: OPTS.timeout500 ? 500 : 504, body: { code: "upstream_timeout" } };
      }
      return { status: 201, body: { id: "o-1" } };
    },
  };
};
