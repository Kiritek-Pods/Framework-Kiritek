"use strict";

// Adapter de referencia de api.http-cache (no-validator): sin ETag ni Last-Modified
// GET /products/kp-1 (público, max-age=300) y GET /me/cart (privado), con ETag y Last-Modified.
const { createHash } = require("node:crypto");

const OPTS = {"noValidator":true};

exports.createApiUnderTest = ({ deps }) => {
  
  const etagOf = (rec) => (OPTS.staticEtag ? '"k1"' : OPTS.sharedEtag ? `"${rec.updatedAt}"` : `"${createHash("sha256").update(JSON.stringify(rec)).digest("hex").slice(0, 16)}"`);
  return {
    async handle(req) {
      const isPublic = req.path.startsWith("/products/");
      if (!isPublic && req.path !== "/me/cart") return { status: 404, body: { code: "not_found" } };
      const user = isPublic ? null : deps.auth.userOf(req.headers);
      if (!isPublic && !user) return { status: 401, body: { code: "unauthenticated" } };
      const rec = await deps.store.read(user);
      const etag = etagOf(rec);
      const lastModified = new Date(rec.updatedAt).toUTCString();
      const headers = {};
      if (!OPTS.noCacheControl) headers["Cache-Control"] = isPublic ? `public, max-age=${OPTS.wrongMaxAge ? 60 : 300}` : OPTS.privatePublic ? "public, max-age=60" : "private, no-cache";
      if (!OPTS.noValidator) {
        headers.ETag = etag;
        headers["Last-Modified"] = lastModified;
      }
      const inm = req.headers["if-none-match"];
      const ims = req.headers["if-modified-since"];
      const notModified = !OPTS.never304 && !OPTS.noValidator && (inm !== undefined ? inm === etag : ims !== undefined && !OPTS.ignoreIms && Date.parse(ims) >= Date.parse(lastModified));
      if (notModified) return { status: 304, headers, body: OPTS.body304 ? { ...rec } : undefined };
      return { status: 200, headers, body: { ...rec } };
    },
  };
};
