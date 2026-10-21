"use strict";

// Adapter de referencia de api.idempotency (ignore-body): acepta la misma clave con otro cuerpo
// Simula un handler HTTP con su almacén de claves en memoria.
const OPTS = {"ignoreBody":true};

exports.createApiUnderTest = ({ clock, deps }) => {
  
  const keys = new Map();
  let seq = 0;
  const wait = (ms) => new Promise((r) => clock.setTimeout(r, ms));
  return {
    async handle(req) {
      const key = req.headers["Idempotency-Key"];
      if (!key) {
        if (!OPTS.optionalKey) return { status: 400, body: { code: "idempotency_key_required" } };
      } else if (!OPTS.noStore) {
        const prev = keys.get(key);
        const body = JSON.stringify(req.body);
        if (prev) {
          if (prev.body !== body && !OPTS.ignoreBody) return { status: 422, body: { code: "idempotency_key_reused" } };
          if (prev.pending && !OPTS.raceUnsafe) return { status: 409, body: { code: "in_progress" } };
          if (!prev.pending) return OPTS.differentReplay ? { status: 200, body: { id: prev.response.body.id, replay: true } } : prev.response;
        }
        if (!OPTS.raceUnsafe) keys.set(key, { body, pending: true });
      }
      await wait(50);
      deps.effect();
      const response = { status: 201, body: { id: `order-${++seq}` } };
      if (key && !OPTS.noStore) keys.set(key, { body: JSON.stringify(req.body), pending: false, response });
      return response;
    },
  };
};
