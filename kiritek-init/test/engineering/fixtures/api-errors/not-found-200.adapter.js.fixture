"use strict";

// Adapter de referencia de api.error-responses (not-found-200): ruta inexistente responde 200
// Handler HTTP mínimo: POST /orders valida { sku: string, qty: entero > 0 }.
const OPTS = {"notFound200":true};

const problem = (status, title) =>
  OPTS.plainErrors ? { status, body: `Error ${status}` } : { status, headers: { "Content-Type": "application/problem+json" }, body: { type: "about:blank", title, status } };

exports.createApiUnderTest = ({ deps }) => {
  
  return {
    async handle(req) {
      if (req.path !== "/orders") return OPTS.notFound200 ? { status: 200, body: {} } : problem(404, "No encontrado");
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (err) {
          if (OPTS.crashOnMalformed) throw err;
          return problem(400, "JSON inválido");
        }
      }
      const invalid = typeof body.sku !== "string" || !Number.isInteger(body.qty) || body.qty <= 0;
      if (invalid && !OPTS.noValidation) return problem(422, "Datos inválidos");
      try {
        await deps.dependency();
      } catch (err) {
        if (OPTS.leakStack) return { status: 500, headers: { "Content-Type": "application/problem+json" }, body: { type: "about:blank", title: "Error", status: 500, detail: err.stack || err.message } };
        return problem(503, "Servicio no disponible");
      }
      if (invalid) return { status: 500, body: { error: "TypeError: Cannot read properties of undefined" } };
      return { status: 201, body: { id: "order-1" } };
    },
  };
};
