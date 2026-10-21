"use strict";

// Adapter de referencia de api.batch (stop-on-error): se detiene en el primer ítem malo
// POST /orders/batch con { items: [{ ref, sku, qty }] }, máximo 50; responde { results: [{ ref, status, error? }] }.
const OPTS = {"stopOnError":true};
const MAX = 50;

exports.createApiUnderTest = ({ deps }) => {
  
  const invalid = (it) => !it || typeof it.sku !== "string" || !it.sku || !Number.isInteger(it.qty) || it.qty < 1;
  const partial = async (items) => {
    const results = [];
    for (const it of items) {
      if (invalid(it)) {
        if (OPTS.stopOnError) break;
        results.push(OPTS.hideErrors ? { ref: it.ref, status: 201 } : { ref: it.ref, status: 422, error: { code: "invalid_item" } });
        continue;
      }
      try {
        await deps.store.save(it);
        results.push({ ref: it.ref, status: 201 });
      } catch (_) {
        if (OPTS.failWhole) throw new Error("lote fallido");
        if (OPTS.stopOnError) break;
        results.push(OPTS.hideErrors ? { ref: it.ref, status: 201 } : { ref: it.ref, status: 409, error: { code: "conflict" } });
      }
    }
    return { status: 207, body: { results: OPTS.reversed ? results.reverse() : results } };
  };
  const atomic = async (items) => {
    const bad = items.findIndex(invalid);
    if (bad !== -1 && !OPTS.noRollback) return { status: 422, body: { code: "invalid_item", index: bad } };
    try {
      if (OPTS.noRollback) for (const it of items) { if (invalid(it)) throw new Error("ítem inválido"); await deps.store.save(it); }
      else await deps.store.transaction(async (tx) => { for (const it of items) await tx.save(it); });
    } catch (_) {
      return { status: 409, body: { code: "batch_failed" } };
    }
    return { status: 201, body: { results: items.map((it) => ({ ref: it.ref, status: 201 })) } };
  };
  return {
    async handle(req) {
      const items = (req.body || {}).items;
      if (!Array.isArray(items)) return { status: 400, body: { code: "items_required" } };
      if (!items.length) {
        if (OPTS.empty500) throw new Error("lote vacío");
        return { status: 200, body: { results: [] } };
      }
      if (items.length > MAX && !OPTS.noLimit) return { status: 413, body: { code: "too_many_items", max: MAX } };
      return OPTS.atomic ? atomic(items) : partial(items);
    },
  };
};
