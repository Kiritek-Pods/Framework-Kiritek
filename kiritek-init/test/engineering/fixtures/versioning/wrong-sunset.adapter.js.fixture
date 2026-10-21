"use strict";

// Adapter de referencia de api.versioning (wrong-sunset): anuncia otra fecha de retiro
// GET /orders en v0 (retirada), v1 (deprecada, retiro 2027-01-31) y v2 (vigente).
const OPTS = {"wrongSunset":true};
const SUNSET = OPTS.wrongSunset ? "Sun, 28 Feb 2027 00:00:00 GMT" : "Sun, 31 Jan 2027 00:00:00 GMT";
const ORDERS = [{ id: "o-1", total: 1200, currency: "CLP" }];
const VIEWS = {
  v1: (o) => (OPTS.breakingV1 ? { id: o.id, amount: o.total } : { id: o.id, total: o.total }),
  v2: (o) => ({ id: o.id, total: o.total, currency: o.currency }),
};

exports.createApiUnderTest = () => {
  
  const versionOf = (req) => {
    if (OPTS.headerScheme) return { version: req.headers["api-version"], rest: req.path };
    const m = /^\/(v\d+)(\/.*)$/.exec(req.path);
    return m ? { version: m[1], rest: m[2] } : { version: undefined, rest: req.path };
  };
  return {
    async handle(req) {
      const { version, rest } = versionOf(req);
      if (rest !== "/orders") return { status: 404, body: { code: "not_found" } };
      if (version === "v0") return OPTS.retiredServed ? { status: 200, body: { items: ORDERS.map(VIEWS.v1) } } : { status: 410, body: { code: "version_retired" } };
      if (version === "v1" && OPTS.v1Removed) return { status: 404, body: { code: "not_found" } };
      let view = VIEWS[version];
      if (!view) {
        if (OPTS.unknown500) throw new Error(`versión ${version}`);
        if (OPTS.unknownLatest) view = VIEWS.v2;
        else return { status: 400, body: { code: "unsupported_version" } };
      }
      const headers = {};
      if ((version === "v1" || OPTS.deprecateAll) && !OPTS.noDeprecation) headers.Deprecation = "@1767225600";
      if (version === "v1" && !OPTS.noSunset) headers.Sunset = SUNSET;
      return { status: 200, headers, body: { items: ORDERS.map(view) } };
    },
  };
};
