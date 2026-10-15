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
  "ui.data-states": { id: "kiritek/engineering/ui-data-states", version: "1.0.0", slug: "ui-data-states", catalog: "2.0.0" },
  "ui.form-validation": { id: "kiritek/engineering/ui-form-validation", version: "1.0.0", slug: "ui-form-validation", catalog: "2.0.0" },
  "net.resilient-requests": { id: "kiritek/engineering/net-resilient-requests", version: "1.0.0", slug: "net-resilient-requests", catalog: "2.0.0" },
  "flags.lifecycle": { id: "kiritek/engineering/flags-lifecycle", version: "1.0.0", slug: "flags-lifecycle", catalog: "2.0.0" },
  "auth.session-expiry": { id: "kiritek/engineering/auth-session-expiry", version: "1.0.0", slug: "auth-session-expiry", catalog: "2.0.0" },
  "ui.file-upload": { id: "kiritek/engineering/ui-file-upload", version: "1.0.0", slug: "ui-file-upload", catalog: "2.0.0" },
  "ui.pagination": { id: "kiritek/engineering/ui-pagination", version: "1.0.0", slug: "ui-pagination", catalog: "2.0.0" },
  "analytics.events": { id: "kiritek/engineering/analytics-events", version: "1.0.0", slug: "analytics-events", catalog: "2.0.0" },
  "ui.destructive-actions": { id: "kiritek/engineering/ui-destructive-actions", version: "1.0.0", slug: "ui-destructive-actions", catalog: "2.0.0" },
  "i18n.formatting": { id: "kiritek/engineering/i18n-formatting", version: "1.0.0", slug: "i18n-formatting", catalog: "2.0.0" },
  "app.offline-mode": { id: "kiritek/engineering/app-offline-mode", version: "1.0.0", slug: "app-offline-mode", catalog: "2.0.0" },
  "app.device-permissions": { id: "kiritek/engineering/app-device-permissions", version: "1.0.0", slug: "app-device-permissions", catalog: "2.0.0" },
  "nav.broken-routes": { id: "kiritek/engineering/nav-broken-routes", version: "1.0.0", slug: "nav-broken-routes", catalog: "2.0.0" },
  "ui.accessible-dialogs": { id: "kiritek/engineering/ui-accessible-dialogs", version: "1.0.0", slug: "ui-accessible-dialogs", catalog: "2.0.0" },
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
