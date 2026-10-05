"use strict";

/**
 * Suite de conformidad para catálogos y packs de controles (T02.4).
 *
 * Se aplica a cualquier catálogo cargado (builtin, cache o plugin, T15B).
 * Un control que declare `enforce` sólo es conforme si su suite de
 * conformidad figura en la lista local de suites aprobadas
 * (`<conformanceSuite>@<approvedVersion>`); por defecto la lista está vacía,
 * así que ningún catálogo puede habilitar enforcement antes de R27.
 */

const { BUILTIN_PROFILES, MOMENT } = require("../contracts/common.js");
const { raise } = require("../errors.js");
const semver = require("./semver.js");

/** Presupuestos máximos por momento (design §12). */
const MOMENT_BUDGET_LIMITS_MS = Object.freeze({
  [MOMENT.AGENT]: 1500,
  [MOMENT.PRE_COMMIT]: 5000,
  [MOMENT.PR]: 600000,
  [MOMENT.RELEASE]: 900000,
});

/**
 * @param {{catalog, parameterSchemas}} loaded  Resultado de `loadCatalogFromFiles`.
 * @param {object} [opts]
 * @param {string[]} [opts.approvedConformanceSuites]  `suite@version` aprobadas.
 * @param {boolean} [opts.requireBuiltinProfiles]  true para el catálogo base.
 * @returns {{passed: boolean, checks: {id, passed, message}[]}}
 */
function runCatalogConformance(loaded, opts = {}) {
  const approved = new Set(opts.approvedConformanceSuites || []);
  const { catalog, parameterSchemas } = loaded;
  const checks = [];
  const check = (id, passed, message) => checks.push({ id, passed: !!passed, message });

  if (opts.requireBuiltinProfiles !== false) {
    const ids = new Set(catalog.profiles.map((p) => p.id));
    const missing = BUILTIN_PROFILES.filter((p) => !ids.has(p));
    check("profiles.builtin", missing.length === 0, missing.length ? `faltan perfiles: ${missing.join(", ")}` : "perfiles builtin presentes");
  }

  const controlIds = new Set(catalog.controls.map((ctl) => ctl.id));
  for (const ctl of catalog.controls) {
    const p = `control:${ctl.id}`;
    check(`${p}.parameters-schema`, !!parameterSchemas[ctl.id], "schema de parámetros cerrado y defaults válidos");

    if (ctl.supportedLevels.includes("enforce")) {
      const key = `${ctl.enforcementContract.conformanceSuite}@${ctl.enforcementContract.approvedVersion}`;
      check(`${p}.enforcement-approved`, approved.has(key), approved.has(key) ? `suite aprobada ${key}` : `declara enforce sin suite de conformidad aprobada (${key})`);
    }

    for (const m of ctl.moments) {
      const limit = MOMENT_BUDGET_LIMITS_MS[m.moment];
      check(`${p}.budget.${m.moment}`, m.budgetMs <= limit, `presupuesto ${m.budgetMs}ms (máximo ${limit}ms)`);
    }
    const maxBudget = Math.max(...ctl.moments.map((m) => m.budgetMs));
    check(`${p}.timeout`, ctl.timeoutMs <= maxBudget, `timeout ${ctl.timeoutMs}ms dentro del mayor presupuesto declarado`);

    if (ctl.deprecation && ctl.deprecation.replacement) {
      check(`${p}.deprecation`, controlIds.has(ctl.deprecation.replacement), `reemplazo ${ctl.deprecation.replacement} definido en el catálogo`);
    }
  }

  for (const m of catalog.migrations) {
    const forward = semver.compare(m.from, m.to) < 0 && semver.compare(m.to, catalog.version) <= 0;
    check(`migration:${m.from}->${m.to}`, forward, "migración hacia adelante y no posterior al catálogo");
    const present = !loaded.files || Object.prototype.hasOwnProperty.call(loaded.files, m.ref);
    check(`migration:${m.from}->${m.to}.notes`, present, present ? `notas ${m.ref}` : `faltan las notas de migración ${m.ref}`);
  }

  return { passed: checks.every((x) => x.passed), checks };
}

function assertCatalogConformance(loaded, opts) {
  const report = runCatalogConformance(loaded, opts);
  if (!report.passed) {
    const failed = report.checks.filter((x) => !x.passed).map((x) => `${x.id}: ${x.message}`);
    raise("CATALOG_CONFORMANCE_FAILED", `catálogo ${loaded.catalog.version} no conforme: ${failed.join("; ")}`, {
      remediation: "Corrija el catálogo o apruebe explícitamente la suite de conformidad requerida.",
    });
  }
  return report;
}

module.exports = { MOMENT_BUDGET_LIMITS_MS, runCatalogConformance, assertCatalogConformance };
