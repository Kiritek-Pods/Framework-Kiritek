"use strict";

// Adapter de referencia de api.concurrency (good-version-field): versión en el campo version del cuerpo
// GET/PATCH /orders/:id con ETag "v<versión>" e If-Match (o campo version).
const OPTS = {"versionField":true};
const etagOf = (rec) => `"v${OPTS.noBump ? 1 : rec.version}"`;

exports.createApiUnderTest = ({ deps }) => {
  
  const id = (path) => path.split("/").pop();
  return {
    async handle(req) {
      const rec = await deps.store.get(id(req.path));
      if (!rec) return { status: 404, body: { code: "not_found" } };
      if (req.method === "GET") {
        if (OPTS.versionField) return { status: 200, body: { ...rec } };
        return { status: 200, headers: OPTS.noEtag ? {} : { ETag: etagOf(rec) }, body: { ...rec, version: undefined } };
      }
      const body = req.body || {};
      const sent = OPTS.versionField ? body.version : req.headers["if-match"];
      if (sent === undefined && !OPTS.optionalPrecondition && !OPTS.ignorePrecondition) return { status: 428, body: { code: "precondition_required" } };
      if (OPTS.rejectAll && sent !== undefined) return { status: 412, body: { code: "precondition_failed" } };
      const matches = sent === undefined || (OPTS.versionField ? Number(sent) === rec.version : sent === etagOf(rec));
      if (!matches && !OPTS.ignorePrecondition) return { status: OPTS.wrongStatus ? 500 : 412, body: { code: "precondition_failed" } };
      const next = { ...rec, name: body.name, version: OPTS.noBump ? rec.version : rec.version + 1 };
      if (OPTS.checkThenSave || OPTS.ignorePrecondition || OPTS.noBump) await deps.store.save(next);
      else if (!(await deps.store.saveIfVersion(next, rec.version))) return { status: 412, body: { code: "precondition_failed" } };
      return { status: 200, headers: OPTS.versionField ? {} : { ETag: etagOf(next) }, body: { ...next, version: OPTS.versionField ? next.version : undefined } };
    },
  };
};
