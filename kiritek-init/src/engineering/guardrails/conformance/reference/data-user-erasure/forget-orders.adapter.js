"use strict";

// Adapter de referencia de data.user-erasure (forget-orders): no toca las órdenes del usuario
// DELETE /users/:userId borra la cuenta, anonimiza sus órdenes y borra sus eventos; GET /admin/users lista.
const OPTS = {"forgetOrders":true};

exports.createServiceUnderTest = ({ deps }) => {
  
  const { users, orders, events } = deps.stores;
  let listingCache = null;
  const listing = async () => (await users.all()).map((u) => ({ id: u.userId, email: u.email, name: u.name }));
  if (OPTS.staleCache) listing().then((l) => (listingCache = l));
  const erased = new Set();
  return {
    async handle(req) {
      if (req.method === "GET" && req.path === "/admin/users") return { status: 200, body: { items: listingCache || (await listing()) } };
      const m = /^\/users\/([\w-]+)$/.exec(req.path);
      if (!m || req.method !== "DELETE") return { status: 404, body: { code: "not_found" } };
      const userId = m[1];
      const exists = (await users.all()).some((u) => u.userId === userId);
      if (!exists) {
        if (erased.has(userId) && OPTS.repeat500) throw new Error("ya borrado");
        if (!erased.has(userId) && OPTS.unknown500) throw new Error("usuario inexistente");
        if (!erased.has(userId) && OPTS.deleteAllOnUnknown) await events.remove(() => true);
        return { status: 404, body: { code: "not_found" } };
      }
      const mine = (r) => r.userId === userId;
      if (OPTS.softDelete) await users.update(mine, { deleted: true });
      else await users.remove(mine);
      if (!OPTS.forgetOrders) await orders.update(mine, OPTS.partialAnon ? { userId: "anon" } : { userId: "anon", email: null, phone: null, name: null });
      await events.remove(OPTS.deleteEveryone ? () => true : mine);
      erased.add(userId);
      return { status: 204 };
    },
  };
};
