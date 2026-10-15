"use strict";

/**
 * Suites de conformidad R27 empaquetadas (T16). Un control sólo puede
 * habilitar `enforce` si su `enforcementContract.conformanceSuite@approvedVersion`
 * coincide con una suite de este registro, la suite pasa (`runConformance`) y
 * la versión está aprobada (`approved.json` del pack u organización).
 *
 * La aprobación queda ligada al contenido (T17): cada entrada de
 * `approved.json` fija el digest de los casos y adapters de referencia de la
 * suite. Si la suite cambia después del gate, deja de estar aprobada hasta un
 * gate nuevo.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SUITES = Object.freeze({
  "search.input-rate": { id: "kiritek/engineering/search-input-rate", version: "1.0.0", slug: "search-input-rate" },
  "app.minimum-supported-version": { id: "kiritek/engineering/app-minimum-supported-version", version: "1.0.0", slug: "app-minimum-supported-version" },
  "web.module-announcement": { id: "kiritek/engineering/web-module-announcement", version: "1.0.0", slug: "web-module-announcement" },
});

const APPROVED_FILE = path.join(__dirname, "approved.json");

const suiteFor = (controlId) => SUITES[controlId] || null;
const suiteRef = (s) => `${s.id}@${s.version}`;

/** Digest del contenido de una suite: casos + adapters de referencia, en orden estable. */
function suiteDigest(slug, root = __dirname) {
  const h = crypto.createHash("sha256");
  const add = (rel) => {
    h.update(`${rel}\0`);
    h.update(fs.readFileSync(path.join(root, rel)));
    h.update("\0");
  };
  add(`cases/${slug}.js`);
  const ref = path.join(root, "reference", slug);
  for (const f of fs.readdirSync(ref).sort()) add(`reference/${slug}/${f}`);
  return `sha256:${h.digest("hex")}`;
}

function readApproved(file = APPROVED_FILE) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(doc.approved) ? doc.approved : [];
}

/**
 * Suites aprobadas cuyo contenido actual coincide con el digest aprobado.
 * Entradas sin digest (o de suites fuera del registro) no cuentan.
 */
function approvedSuites({ file = APPROVED_FILE, root = __dirname } = {}) {
  const bySlug = new Map(Object.values(SUITES).map((s) => [suiteRef(s), s]));
  const out = [];
  for (const e of readApproved(file)) {
    const s = e && typeof e === "object" ? bySlug.get(e.ref) : null;
    if (!s || typeof e.digest !== "string") continue;
    if (suiteDigest(s.slug, root) === e.digest) out.push(e.ref);
  }
  return out;
}

module.exports = { SUITES, APPROVED_FILE, suiteFor, suiteRef, suiteDigest, readApproved, approvedSuites };
