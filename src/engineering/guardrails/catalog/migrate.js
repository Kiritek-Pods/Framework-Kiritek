"use strict";

/**
 * Migraciones semánticas entre versiones de catálogo (R4.4, R4.7; T02.3).
 *
 * - `planMigrationPath` encadena las migraciones declaradas por el catálogo
 *   destino desde la versión actual. Un salto major sin cadena falla.
 * - `migrateControlIds` propone el renombrado de controles deprecados con
 *   reemplazo en una configuración. Es puro: no escribe ni promueve niveles;
 *   la aplicación transaccional vive en el lifecycle (T15C).
 */

const semver = require("./semver.js");
const { raise } = require("../errors.js");

function planMigrationPath(fromVersion, toCatalog) {
  if (semver.compare(fromVersion, toCatalog.version) >= 0) return [];
  const sameMajor = semver.parse(fromVersion).major === semver.parse(toCatalog.version).major;
  const steps = [];
  let current = fromVersion;
  const guard = new Set();
  while (semver.compare(current, toCatalog.version) < 0) {
    const next = toCatalog.migrations
      .filter((m) => m.from === current)
      .sort((a, b) => semver.compare(b.to, a.to))[0];
    if (!next) break;
    if (guard.has(next.from)) raise("CATALOG_MIGRATION_CYCLE", `ciclo de migraciones en ${next.from}`);
    guard.add(next.from);
    steps.push({ from: next.from, to: next.to, ref: next.ref });
    current = next.to;
  }
  if (semver.compare(current, toCatalog.version) < 0 && !sameMajor) {
    raise("CATALOG_MIGRATION_MISSING", `no hay cadena de migración de ${fromVersion} a ${toCatalog.version}`, {
      remediation: "El catálogo destino debe declarar migraciones para saltos major.",
    });
  }
  return steps;
}

/**
 * @param {object} config  Config engineering (no se muta).
 * @param {object} toCatalog
 * @returns {{config: object, changes: {pointer, from, to}[]}}
 */
function migrateControlIds(config, toCatalog) {
  const renames = new Map(
    toCatalog.controls.filter((c) => c.deprecation && c.deprecation.replacement).map((c) => [c.id, c.deprecation.replacement])
  );
  const out = JSON.parse(JSON.stringify(config));
  const changes = [];
  const renameIn = (controls, pointer) => {
    if (!controls) return;
    for (const [id, target] of renames) {
      if (!Object.prototype.hasOwnProperty.call(controls, id)) continue;
      if (Object.prototype.hasOwnProperty.call(controls, target)) {
        raise("CONFIG_MIGRATION_CONFLICT", `${pointer}: ya existen ${id} y su reemplazo ${target}`);
      }
      controls[target] = controls[id];
      delete controls[id];
      changes.push({ pointer, from: id, to: target });
    }
  };
  renameIn(out.defaults && out.defaults.controls, "/defaults/controls");
  ((out.workspace && out.workspace.units) || []).forEach((u, i) => renameIn(u.controls, `/workspace/units/${i}/controls`));
  return { config: out, changes };
}

module.exports = { planMigrationPath, migrateControlIds };
