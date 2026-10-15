"use strict";

/**
 * Lifecycle transaccional del pack engineering: install / update / migrate
 * (T15C.1, T15C.2, T15C.4; design §16).
 *
 *   validar (config/catálogo/compatibilidad) → plan (artefactos, superficies,
 *   catálogo, niveles efectivos) → dry-run │ conflicto ⇒ detener sin mutar
 *   → backup → aplicar (reconcile, superficies, config, inventario, wiring)
 *   → verificar (config resuelve, linkage, self-checks) → éxito
 *   └─ cualquier fallo ⇒ restaurar backup y VERIFICAR la restauración.
 *
 * Garantías:
 *  - Nunca promueve en silencio: controles nuevos del catálogo destino quedan
 *    `off` en la config (habilitarlos es explícito) y si un default sube de
 *    nivel se fija el nivel previo en la unidad.
 *  - Downgrade sólo si la config resuelve con el catálogo destino; si no, se
 *    bloquea con plan de recuperación.
 *  - Una sobrescritura de contenido personalizado detiene la operación sin
 *    mutar (propuesta/diff explícitos).
 *  - migrate es reentrante e idempotente (segunda corrida: changed=false).
 */

const fs = require("node:fs");
const path = require("node:path");
const inventory = require("../../../install/inventory.js");
const { install } = require("./reconcile.js");
const { buildDesiredArtifacts } = require("./artifacts.js");
const { createBackup, restoreBackup, pruneBackups } = require("./backup.js");
const { CONFIG_FILE } = require("../config/defaults.js");
const { PACK_ID } = require("../contracts/common.js");
const { resolveEngineeringConfig } = require("../config/index.js");
const { resolveCatalog, createCatalogSession } = require("../catalog/resolve.js");
const { diffCatalogs } = require("../catalog/diff.js");
const semver = require("../catalog/semver.js");
const surfacesInstall = require("../adapters/install.js");
const git = require("../adapters/git.js");
const { observeSurfaces } = require("../audit/surfaces.js");
const { runSelfChecks } = require("../audit/self-check.js");
const { checkLinkage } = require("../audit/capabilities.js");
const { controlsFor } = require("../controls/index.js");

const PACK_VERSION = require("../../../../package.json").version;
const WIRING = ".kiritek/engineering/wiring.json";
const LEVEL_RANK = { off: 0, warn: 1, enforce: 2 };

function lifecycleError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function readConfigDoc(repoRoot) {
  const abs = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (_) {
    throw lifecycleError("CONFIG_PARSE", `${CONFIG_FILE} no es JSON válido: se detiene sin mutar`);
  }
}

function resolveDoc(repoRoot, doc, catalogOptions) {
  return resolveEngineeringConfig({ document: doc, env: {}, repoRoot, catalogSession: createCatalogSession(catalogOptions || {}) });
}

const levelsOf = (resolved) => Object.fromEntries(resolved.effective.units.flatMap((u) => Object.entries(u.controls).map(([id, c]) => [`${u.unit.id}|${id}`, c.level])));

/**
 * Plan de cambio de catálogo (R22.2, R22.5, R22.7). Devuelve el documento de
 * config destino con los gates nuevos en off y los niveles previos fijados.
 */
function planCatalogChange({ repoRoot, doc, to, catalogOptions }) {
  const from = doc.pack.catalog;
  const fromSnap = resolveCatalog({ ...(catalogOptions || {}), version: from });
  let toSnap;
  try {
    toSnap = resolveCatalog({ ...(catalogOptions || {}), version: to });
  } catch (err) {
    return { blocked: true, code: err.code || "CATALOG_ERROR", reason: err.message, recovery: [`Instale/verifique el catálogo ${to} o mantenga ${from}.`] };
  }
  const diff = diffCatalogs(fromSnap.catalog, toSnap.catalog);
  const downgrade = semver.compare(to, from) < 0;
  const next = JSON.parse(JSON.stringify(doc));
  next.pack.catalog = to;
  if (next.pack.catalogDigest) next.pack.catalogDigest = toSnap.ref.digest;
  const fromIds = new Set(fromSnap.catalog.controls.map((c) => c.id));
  const configured = (id) => (doc.defaults && doc.defaults.controls && doc.defaults.controls[id]) || ((doc.workspace && doc.workspace.units) || []).some((u) => u.controls && u.controls[id]);
  const newGates = [];
  for (const c of toSnap.catalog.controls) {
    if (fromIds.has(c.id) || configured(c.id)) continue;
    next.defaults = next.defaults || {};
    next.defaults.controls = next.defaults.controls || {};
    next.defaults.controls[c.id] = { level: "off" };
    newGates.push(c.id);
  }
  const before = levelsOf(resolveDoc(repoRoot, doc, catalogOptions));
  let after;
  try {
    after = levelsOf(resolveDoc(repoRoot, next, catalogOptions));
  } catch (err) {
    return {
      blocked: true,
      code: downgrade ? "CATALOG_DOWNGRADE_BLOCKED" : "CATALOG_UPDATE_INCOMPATIBLE",
      reason: `la config actual no resuelve con ${to}: ${err.code || "error"} ${err.message}`,
      recovery: downgrade
        ? [`Quite de la config los controles/parámetros que ${to} no conoce (ver diff), o permanezca en ${from}.`, "La evidencia existente se conserva y no se reutiliza si es incompatible."]
        : ["Revise el diff del catálogo y ajuste la config antes de actualizar."],
      diff,
    };
  }
  // Un default que sube de nivel no promueve unidades existentes: se fija el previo.
  const pinned = [];
  for (const [key, level] of Object.entries(after)) {
    const prev = before[key];
    if (prev === undefined || LEVEL_RANK[level] <= LEVEL_RANK[prev]) continue;
    const [unitId, controlId] = key.split("|");
    const unit = (next.workspace.units || []).find((u) => u.id === unitId);
    unit.controls = unit.controls || {};
    unit.controls[controlId] = { ...(unit.controls[controlId] || {}), level: prev };
    pinned.push({ unitId, controlId, kept: prev, wouldBe: level });
  }
  const finalLevels = pinned.length ? levelsOf(resolveDoc(repoRoot, next, catalogOptions)) : after;
  const levelChanges = Object.keys(finalLevels).filter((k) => before[k] !== finalLevels[k]).map((k) => ({ key: k, from: before[k] || null, to: finalLevels[k] }));
  return { blocked: false, from, to, downgrade, diff, newGates, pinned, levelChanges, nextDoc: next };
}

function surfaceTargets(repoRoot, surfaces) {
  const t = [WIRING];
  if (surfaces.includes("kiro")) t.push(surfacesInstall.KIRO_SHIM, surfacesInstall.KIRO_HOOK);
  if (surfaces.includes("claude")) t.push(surfacesInstall.CLAUDE_SHIM, surfacesInstall.CLAUDE_SETTINGS);
  if (surfaces.includes("ci")) t.push(surfacesInstall.CI_WORKFLOW, `${surfacesInstall.CI_WORKFLOW}.kiritek-new`);
  if (surfaces.includes("git")) t.push(git.HOOK_SCRIPT, git.PREVIOUS, path.join(git.hooksDir(repoRoot).dir, "pre-commit"));
  return t;
}

function readWiring(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, WIRING), "utf8"));
  } catch (_) {
    return { schemaVersion: 1, surfaces: {} };
  }
}

function writeJson(repoRoot, rel, value) {
  const abs = path.join(repoRoot, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.kiritek-tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, abs);
}

/** Versiones de pack/catálogo en las entradas engineering del inventario (R22.1). */
function stampInventory(repoRoot, catalogVersion) {
  const inv = inventory.readInventory(repoRoot);
  let changed = false;
  for (const e of Object.values(inv.entries)) {
    if (e.owner !== PACK_ID) continue;
    if (e.packVersion !== PACK_VERSION || (catalogVersion && e.catalogVersion !== catalogVersion)) {
      e.packVersion = PACK_VERSION;
      if (catalogVersion) e.catalogVersion = catalogVersion;
      changed = true;
    }
  }
  if (changed) writeJson(repoRoot, inventory.INVENTORY_FILENAME, inv);
  return changed;
}

/** Verificación posterior: config resuelve, linkage completo y self-checks verdes. */
function postChecks(repoRoot, catalogOptions, { resolveConfig = true } = {}) {
  const doc = resolveConfig ? readConfigDoc(repoRoot) : null;
  if (!doc) {
    // install: la config del usuario puede no estar lista aún; se verifica el motor.
    const sc = runSelfChecks(require("../controls/index.js").builtinControls());
    return sc.passed ? [] : sc.checks.filter((c) => !c.passed).map((c) => `self-check ${c.controlId || ""}:${c.id}`);
  }
  const session = createCatalogSession(catalogOptions || {});
  const resolved = resolveEngineeringConfig({ document: doc, env: {}, repoRoot, catalogSession: session });
  const controls = controlsFor(session.snapshot, { repoRoot });
  // Un control off en todas las unidades (p. ej. gate nuevo fijado off) no
  // necesita implementación todavía; uno activo sí.
  const levels = levelsOf(resolved);
  const active = (id) => Object.entries(levels).some(([k, lv]) => k.endsWith(`|${id}`) && lv !== "off");
  const problems = session.snapshot.catalog.controls.filter((c) => active(c.id) && checkLinkage(c, controls[c.id]) !== "verified").map((c) => `linkage ${c.id}`);
  const sc = runSelfChecks(controls);
  if (!sc.passed) problems.push(...sc.checks.filter((c) => !c.passed).map((c) => `self-check ${c.controlId || ""}:${c.id}`));
  if (!resolved.configHash) problems.push("config sin hash");
  return problems;
}

/**
 * @param {object} o
 * @param {string} o.repoRoot
 * @param {"install"|"update"|"migrate"} o.action
 * @param {boolean} [o.dryRun]
 * @param {string[]} [o.surfaces]      Superficies a enlazar (install/update).
 * @param {string} [o.to]              Catálogo destino (update).
 * @param {object} [o.catalogOptions]
 * @param {string} o.now               ISO (sello del backup).
 * @param {string} [o.faultAt]         Inyección de fallo (pruebas): reconcile|surfaces|config|inventory|verify.
 */
function runLifecycle(o) {
  const { repoRoot, action } = o;
  const surfaces = [...new Set([...(o.surfaces || []), ...(action === "update" ? Object.keys(readWiring(repoRoot).surfaces) : [])])];
  const doc = readConfigDoc(repoRoot);
  const plan = { action, surfaces, artifacts: null, catalog: null, steps: [] };

  // 1. Validar antes de mutar.
  if (doc && action !== "install") resolveDoc(repoRoot, doc, o.catalogOptions);
  if (action === "update" && o.to && doc && o.to !== doc.pack.catalog) {
    plan.catalog = planCatalogChange({ repoRoot, doc, to: o.to, catalogOptions: o.catalogOptions });
    if (plan.catalog.blocked) return { ...base(o, plan), applied: false, blocked: true, code: plan.catalog.code };
  }
  // 2. Plan de artefactos (sin mutar); conflicto ⇒ detener.
  const dry = install({ repoRoot, dryRun: true });
  plan.reconcile = dry;
  plan.artifacts = { summary: dry.summary, conflicts: dry.conflicts || [] };
  plan.surfacePlan = surfaces.length ? surfacesInstall.linkSurfaces(repoRoot, surfaces, { dryRun: true }) : [];
  if (action !== "install" && plan.artifacts.conflicts.length) {
    return { ...base(o, plan), applied: false, blocked: true, code: "MIGRATION_CONFLICT", reason: `contenido personalizado en ${plan.artifacts.conflicts.join(", ")}: resuelva manualmente (diff vs plantilla)` };
  }
  if (o.dryRun) return { ...base(o, plan), applied: false, reconcile: dry, surfaces: plan.surfacePlan };

  // 3. Backup de todo lo que puede tocarse.
  const targets = [CONFIG_FILE, inventory.INVENTORY_FILENAME, ...buildDesiredArtifacts().map((a) => a.path), ...buildDesiredArtifacts().map((a) => `${a.path}.kiritek-new`), ...surfaceTargets(repoRoot, surfaces)];
  const backup = createBackup(repoRoot, targets, { stamp: `${o.now}-${action}` });
  const fault = (step) => {
    if (o.faultAt === step) throw lifecycleError("FAULT_INJECTED", `fallo inyectado en ${step}`);
  };
  const steps = [];
  let reconcileResult = null;
  let surfaceResults = [];
  try {
    const rec = install({ repoRoot });
    reconcileResult = rec;
    if (rec.rolledBack) throw lifecycleError("INSTALL_ROLLED_BACK", rec.error || "reconcile revertido");
    steps.push({ step: "reconcile", changed: Object.entries(rec.summary || {}).some(([k, v]) => k !== "noop" && v > 0), conflicts: rec.conflicts || [] });
    fault("reconcile");

    if (surfaces.length) {
      const linked = surfacesInstall.linkSurfaces(repoRoot, surfaces);
      surfaceResults = linked;
      const wiring = readWiring(repoRoot);
      for (const s of linked) wiring.surfaces[s.surface] = { status: s.status, ...(s.reason ? { reason: s.reason } : {}) };
      writeJson(repoRoot, WIRING, wiring);
      steps.push({ step: "surfaces", changed: linked.some((s) => s.status === "linked"), results: linked });
    }
    fault("surfaces");

    if (plan.catalog && !plan.catalog.blocked) {
      writeJson(repoRoot, CONFIG_FILE, plan.catalog.nextDoc);
      steps.push({ step: "config", changed: true, newGatesOff: plan.catalog.newGates, pinned: plan.catalog.pinned });
    }
    fault("config");

    if (action === "migrate") {
      const wiring = readWiring(repoRoot);
      const observed = observeSurfaces(repoRoot);
      let changed = false;
      for (const [name, key] of [["kiro", "kiro"], ["claude", "claude"], ["git", "git-pre-commit"], ["ci", "ci"]]) {
        if (!wiring.surfaces[name] && observed[key].status !== "missing" && observed[key].observation !== "not-applicable") {
          wiring.surfaces[name] = { status: "adopted", observed: observed[key].status };
          changed = true;
        }
      }
      if (changed) writeJson(repoRoot, WIRING, wiring);
      steps.push({ step: "register-wiring", changed });
      steps.push({ step: "gates", changed: false, note: "la migración nunca cambia niveles" });
    }
    const current = readConfigDoc(repoRoot);
    steps.push({ step: "inventory-metadata", changed: stampInventory(repoRoot, current && current.pack.catalog) });
    fault("inventory");

    const problems = postChecks(repoRoot, o.catalogOptions, { resolveConfig: action !== "install" });
    fault("verify");
    if (problems.length) throw lifecycleError("LIFECYCLE_VERIFY_FAILED", `verificación posterior fallida: ${problems.join("; ")}`);
  } catch (err) {
    const restoration = restoreBackup(repoRoot, backup.ref);
    return { ...base(o, plan), applied: false, rolledBack: true, verified: restoration.verified, code: err.code || "LIFECYCLE_FAILED", error: err.message, backupRef: backup.ref, steps, reconcile: reconcileResult };
  }
  pruneBackups(repoRoot);
  return { ...base(o, plan), applied: true, changed: steps.some((s) => s.changed), steps, backupRef: backup.ref, reconcile: reconcileResult, surfaces: surfaceResults };
}

function base(o, plan) {
  return { pack: PACK_ID, action: o.action, dryRun: !!o.dryRun, plan };
}

/**
 * Uninstall con política de retención (T15C.4, R22.6): quita artefactos y
 * wiring engineering, restaura composición (hook previo), conserva security,
 * user-owned, waivers/N-A y — salvo `purgeEvidence` — evidencia, telemetría y
 * backups.
 */
function uninstallWithPolicy({ repoRoot, dryRun = false, purgeEvidence = false }) {
  const { uninstall } = require("./uninstall.js");
  const res = uninstall({ repoRoot, dryRun });
  if (dryRun || res.rolledBack) return { ...res, purgeEvidence };
  surfacesInstall.unlinkSurfaces(repoRoot);
  fs.rmSync(path.join(repoRoot, WIRING), { force: true });
  const data = [".kiritek/evidence/engineering", ".kiritek/telemetry/engineering", ".kiritek/cache/engineering", ".kiritek/backups/engineering"];
  const purged = [];
  const preservedData = [];
  for (const rel of data) {
    const abs = path.join(repoRoot, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    if (purgeEvidence) {
      fs.rmSync(abs, { recursive: true, force: true });
      purged.push(rel);
    } else preservedData.push(rel);
  }
  return { ...res, purgeEvidence, purged, preservedData, preservedGovernance: [".kiritek/engineering/waivers", ".kiritek/engineering/not-applicable"].filter((r) => fs.existsSync(path.join(repoRoot, ...r.split("/")))) };
}

module.exports = { WIRING, runLifecycle, planCatalogChange, uninstallWithPolicy, readWiring };
