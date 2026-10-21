"use strict";

// Adapter de referencia de api.pagination (no-end): nunca indica el final
// GET /orders paginado por cursor (id del último ítem), 20 por defecto, 100 máx.
const OPTS = {"noEnd":true};
const DEFAULT = 20;
const MAX = 100;

exports.createApiUnderTest = ({ deps }) => {
  
  return {
    async handle(req) {
      const all = deps.store.all();
      let limit = req.query.limit === undefined ? (OPTS.wrongDefault ? 50 : DEFAULT) : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        if (OPTS.crashBadLimit) throw new Error("limit inválido");
        return { status: 400, body: { code: "invalid_limit" } };
      }
      if (!OPTS.noMax) limit = Math.min(limit, MAX);
      let start = 0;
      if (req.query.cursor !== undefined) {
        if (OPTS.offsetCursor) start = Number(req.query.cursor);
        else {
          const i = all.findIndex((x) => x.id === req.query.cursor);
          if (i === -1) {
            if (OPTS.lenientCursor) start = 0;
            else return { status: 400, body: { code: "invalid_cursor" } };
          } else start = i + 1;
        }
        if (Number.isNaN(start)) start = 0;
        if (OPTS.overlap) start = Math.max(0, start - 1);
      }
      const items = all.slice(start, start + limit);
      const more = start + limit < all.length;
      const next = OPTS.noEnd ? (items.length ? items[items.length - 1].id : "fin") : more ? (OPTS.offsetCursor ? String(start + limit) : items[items.length - 1].id) : null;
      return { status: 200, body: { items: OPTS.shuffle ? [...items].reverse() : items, nextCursor: next } };
    },
  };
};
