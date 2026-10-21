"use strict";

/**
 * Launch manifest (T12.1–T12.3): lectura, validación de forma y extracción
 * de HECHOS mínimos. No se copian textos libres (razones, criterios de
 * audiencia, referencias de aprobación) al resultado: sólo ids estables,
 * enums, booleanos y fechas.
 */

const fs = require("node:fs");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");

const SCHEMA = "engineering/controls/web-module-announcement.manifest";

/** Atributos de audiencia permitidos (no identifican personas ni datos sensibles). */
const ALLOWED_ATTRIBUTES = new Set(["role", "plan", "tier", "locale", "region", "country", "platform", "app-version", "feature-flag", "cohort", "workspace-type", "tenant-tier"]);
const PII_VALUE_RES = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /(?:\+?\d[\s-]?){7,}/, // teléfono / identificador numérico largo
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // uuid
  /^(?:\d{1,3}\.){3}\d{1,3}$/, // ip
];

function audienceFacts(a) {
  const attributes = [...new Set(a.criteria.map((c) => c.attribute))].sort();
  const sensitive = a.criteria.some((c) => !ALLOWED_ATTRIBUTES.has(c.attribute) || c.values.some((v) => PII_VALUE_RES.some((re) => re.test(v))));
  return { id: a.id, attributes, sensitive, channels: [...a.channels].sort(), fallbackChannel: a.fallbackChannel || null };
}

function factsOf(doc) {
  const announcements = (doc.announcements || []).map((a) => {
    const last = a.rollout.history[a.rollout.history.length - 1];
    const times = a.rollout.history.map((h) => Date.parse(h.at));
    return {
      id: a.id,
      version: a.version,
      window: { start: a.window.start, end: a.window.end },
      owner: a.owner,
      audiences: a.audiences.map(audienceFacts),
      channels: [...a.channels].sort(),
      content: { locales: [...a.content.locales].sort(), defaultLocale: a.content.defaultLocale, missingContent: a.content.missingContent },
      showOnce: { ...a.showOnce },
      rollout: { state: a.rollout.state, lastHistoryState: last.state, historyOrdered: times.every((t, i) => i === 0 || t >= times[i - 1]), historyCount: times.length },
      animated: !!(a.presentation && a.presentation.animated),
    };
  });
  return {
    modules: doc.modules.map((m) => ({ moduleId: m.moduleId, announcementRequired: m.announcementRequired, announcementId: m.announcementId || null, governedNaRef: m.governedNaRef || null })),
    announcements,
    governedNa: (doc.governedNa || []).map((n) => ({ ref: n.ref, moduleId: n.moduleId, reviewBy: n.reviewBy, criticality: n.criticality || "low", secondApproval: !!n.approval.secondBy })),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

/** @returns {{declared, valid, errorCodes, manifest?, facts?}} */
function loadLaunchManifest(repoRoot, relPath) {
  if (!relPath) return { declared: false, valid: false, errorCodes: [] };
  const target = containReal(repoRoot, relPath);
  if (!target.contained) return { declared: true, valid: false, errorCodes: ["MANIFEST_PATH_OUTSIDE_REPO"] };
  if (!fs.existsSync(target.realPath)) return { declared: true, valid: false, errorCodes: ["MANIFEST_FILE_MISSING"] };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(target.realPath, "utf8"));
  } catch (_) {
    return { declared: true, valid: false, errorCodes: ["MANIFEST_PARSE"] };
  }
  if (!validateAgainst(SCHEMA, doc, { extended: true }).valid) return { declared: true, valid: false, errorCodes: ["MANIFEST_SCHEMA"] };
  const dup = (list, key) => new Set(list.map((x) => x[key])).size !== list.length;
  if (dup(doc.modules, "moduleId") || dup(doc.announcements || [], "id") || dup(doc.governedNa || [], "ref")) {
    return { declared: true, valid: false, errorCodes: ["MANIFEST_DUPLICATE_ID"] };
  }
  return { declared: true, valid: true, errorCodes: [], manifest: doc, facts: factsOf(doc) };
}

module.exports = { SCHEMA, ALLOWED_ATTRIBUTES, loadLaunchManifest, factsOf };
