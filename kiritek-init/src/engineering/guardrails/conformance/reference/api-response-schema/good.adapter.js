"use strict";

// Adapter de referencia de api.response-schema (good): implementación correcta
// POST /orders crea una orden y responde 201 con { id, status, total: { amount, currency }, items[] }.
const OPTS = {};

exports.createApiUnderTest = () => {
  
  return {
    async handle(req) {
      const b = req.body || {};
      if (!Array.isArray(b.items) || !b.items.length) {
        if (OPTS.error500) throw new Error("items requerido");
        return OPTS.plainError ? { status: 400, headers: { "content-type": "text/plain" }, body: "items requerido" } : { status: 400, body: { code: "invalid_request", message: "items requerido", fields: ["items"] } };
      }
      const order = {
        id: "o-1",
        status: OPTS.badEnum ? "PENDING" : "pending",
        total: { amount: OPTS.stringAmount ? "1200" : 1200, currency: "CLP" },
        items: b.items.map((it) => ({ sku: it.sku, qty: it.qty })),
        ...(OPTS.nullNote ? { note: null } : {}),
        ...(OPTS.extraField ? { internalCost: 830 } : {}),
      };
      if (OPTS.missingRequired) delete order.status;
      return { status: OPTS.wrongStatus ? 200 : 201, body: order };
    },
  };
};
