"use strict";

/**
 * Plan/diff entre dos catálogos (R4.4, R4.5, R4.7; T02.3).
 *
 * Reporta controles añadidos, retirados, renombrados (deprecación con
 * reemplazo), cambios por campo, cambios de nivel por defecto/soportado,
 * deprecaciones nuevas, migraciones requeridas y si el salto de versión
 * respeta semver: major para contratos/enforcement/retiros, minor para
 * añadidos/defaults/momentos, patch sin cambios semánticos.
 */

const { canonicalJson } = require("../canonical.js");
const semver = require("./semver.js");
const { planMigrationPath } = require("./migrate.js");

const BUMP_RANK = Object.freeze({ none: 0, patch: 1, minor: 2, major: 3 });

const FIELD_BUMP = Object.freeze({
  contractVersion: "major",
  enforcementContract: "major",
  supportedLevels: "major",
  profiles: "major",
  "defaults.level": "minor",
  "defaults.parameters": "minor",
  moments: "minor",
  costClass: "minor",
  timeoutMs: "minor",
  cachePolicy: "minor",
  freshness: "minor",
  permissions: "major",
  collectors: "minor",
  normalizer: "minor",
  applicability: "major",
  evaluator: "minor",
  parametersSchemaRef: "minor",
  documentationRef: "patch",
  version: "patch",
  deprecation: "minor",
});

function get(obj, dotted) {
  return dotted.split(".").reduce((acc, k) => (acc === undefined ? undefined : acc[k]), obj);
}

function bumpOf(fromVersion, toVersion) {
  const a = semver.parse(fromVersion);
  const b = semver.parse(toVersion);
  if (semver.compare(a, b) >= 0) return "none";
  if (b.major !== a.major) return "major";
  if (b.minor !== a.minor) return "minor";
  return "patch";
}

function maxBump(a, b) {
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

function controlChanges(a, b) {
  const changes = [];
  for (const field of Object.keys(FIELD_BUMP)) {
    const av = get(a, field);
    const bv = get(b, field);
    if (canonicalJson(av === undefined ? null : av) !== canonicalJson(bv === undefined ? null : bv)) {
      let bump = FIELD_BUMP[field];
      if (field === "contractVersion" && av && bv && semver.parse(av).major === semver.parse(bv).major) bump = "minor";
      changes.push({ field, from: av === undefined ? null : av, to: bv === undefined ? null : bv, requiredBump: bump });
    }
  }
  return changes;
}

/**
 * @param {object} from Catálogo (contrato) actual.
 * @param {object} to   Catálogo (contrato) candidato.
 */
function diffCatalogs(from, to) {
  const fromCtl = new Map(from.controls.map((c) => [c.id, c]));
  const toCtl = new Map(to.controls.map((c) => [c.id, c]));
  let required = "none";

  const added = [...toCtl.keys()].filter((id) => !fromCtl.has(id)).sort();
  const removed = [...fromCtl.keys()].filter((id) => !toCtl.has(id)).sort();
  if (added.length) required = maxBump(required, "minor");
  if (removed.length) required = maxBump(required, "major");

  const renamed = [];
  const deprecations = [];
  for (const [id, ctl] of toCtl) {
    if (!ctl.deprecation) continue;
    const wasDeprecated = fromCtl.has(id) && fromCtl.get(id).deprecation;
    if (!wasDeprecated) deprecations.push({ id, since: ctl.deprecation.since, reason: ctl.deprecation.reason, replacement: ctl.deprecation.replacement || null });
    if (ctl.deprecation.replacement && added.includes(ctl.deprecation.replacement)) {
      renamed.push({ from: id, to: ctl.deprecation.replacement });
    }
  }

  const changed = [];
  const levelChanges = [];
  for (const [id, a] of fromCtl) {
    const b = toCtl.get(id);
    if (!b) continue;
    const changes = controlChanges(a, b);
    if (!changes.length) continue;
    changed.push({ id, changes });
    for (const ch of changes) {
      required = maxBump(required, ch.requiredBump);
      if (ch.field === "defaults.level" || ch.field === "supportedLevels") levelChanges.push({ controlId: id, field: ch.field, from: ch.from, to: ch.to });
    }
  }

  const fromProf = new Map(from.profiles.map((p) => [p.id, p]));
  const toProf = new Map(to.profiles.map((p) => [p.id, p]));
  const profiles = {
    added: [...toProf.keys()].filter((id) => !fromProf.has(id)).sort(),
    removed: [...fromProf.keys()].filter((id) => !toProf.has(id)).sort(),
    changed: [...toProf.keys()].filter((id) => fromProf.has(id) && canonicalJson(fromProf.get(id)) !== canonicalJson(toProf.get(id))).sort(),
  };
  if (profiles.removed.length || profiles.changed.length) required = maxBump(required, "major");
  if (profiles.added.length) required = maxBump(required, "minor");
  if (canonicalJson(from.compatibility) !== canonicalJson(to.compatibility)) required = maxBump(required, "minor");

  const actual = bumpOf(from.version, to.version);
  const semverViolations = [];
  if (actual === "none" && (required !== "none" || from.digest !== to.digest)) {
    semverViolations.push(`contenido distinto sin incrementar versión (${from.version} → ${to.version})`);
  } else if (BUMP_RANK[actual] < BUMP_RANK[required]) {
    semverViolations.push(`los cambios requieren bump ${required} y el salto ${from.version} → ${to.version} es ${actual}`);
  }

  let migrations = [];
  let migrationError = null;
  if (actual === "major") {
    try {
      migrations = planMigrationPath(from.version, to);
    } catch (err) {
      migrationError = err.message;
    }
  }

  return {
    from: { version: from.version, digest: from.digest },
    to: { version: to.version, digest: to.digest },
    controls: { added, removed, renamed, changed },
    profiles,
    levelChanges,
    deprecations,
    migrations,
    migrationError,
    requiredBump: required,
    actualBump: actual,
    semverViolations,
  };
}

module.exports = { diffCatalogs, bumpOf };
