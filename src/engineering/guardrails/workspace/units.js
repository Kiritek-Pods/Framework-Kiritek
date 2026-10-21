"use strict";

/**
 * Resolución de unidades y perfiles efectivos (T04.1, T04.3, T04.4).
 *
 * - Parte SIEMPRE de unidades declaradas en la config efectiva (T03); el
 *   discovery no participa aquí.
 * - Cierre de perfiles compuestos por `extends` del catálogo: un perfil base
 *   alcanzado por composición se marca `inherited` con procedencia del
 *   perfil que lo extiende. Ciclos o versiones incompatibles fallan.
 * - Roots confinados al repo tras resolver symlinks; root inexistente es
 *   diagnóstico, no error (el árbol puede no estar materializado).
 * - Estado por perfil: `explicit` | `inherited` | `suggested` | `undeclared`.
 */

const path = require("node:path");
const fs = require("node:fs");
const { containReal } = require("../../../platform/paths.js");
const { PROFILE_SOURCE, deepFreeze } = require("../contracts/common.js");
const { raise } = require("../errors.js");
const { unitRootHash, createIdentityIndex, compareIds } = require("./identity.js");

const PROFILE_STATUS = Object.freeze({
  EXPLICIT: "explicit",
  INHERITED: "inherited",
  SUGGESTED: "suggested",
  UNDECLARED: "undeclared",
});

/**
 * Expande perfiles declarados con su cierre `extends` del catálogo.
 * Los declarados ganan sobre los alcanzados por composición.
 */
function closeProfiles(declared, catalog, unitId) {
  const defs = new Map(catalog.profiles.map((p) => [p.id, p]));
  const out = new Map();
  for (const p of declared) {
    out.set(p.id, {
      id: p.id,
      version: p.version,
      source: p.source,
      parameters: p.parameters,
      provenance: p.provenance,
      via: [],
    });
  }
  const visit = (profileId, chain) => {
    const def = defs.get(profileId);
    if (!def) raise("PROFILE_UNKNOWN", `unidad ${unitId}: perfil ${profileId} no existe en el catálogo ${catalog.version}`);
    for (const base of def.extends) {
      if (chain.includes(base.id)) {
        raise("PROFILE_CYCLE", `unidad ${unitId}: ciclo de perfiles ${[...chain, base.id].join(" → ")}`);
      }
      const baseDef = defs.get(base.id);
      if (!baseDef || baseDef.version !== base.version) {
        raise("PROFILE_INCOMPATIBLE", `unidad ${unitId}: ${profileId} extiende ${base.id}@${base.version}, el catálogo publica ${baseDef ? baseDef.version : "ninguna"}`, {
          remediation: "Alinee las versiones de perfiles compuestos con el catálogo fijado.",
        });
      }
      const existing = out.get(base.id);
      if (existing && existing.version !== base.version) {
        raise("PROFILE_INCOMPATIBLE", `unidad ${unitId}: ${base.id} requerido en dos versiones (${existing.version}, ${base.version})`);
      }
      if (!existing) {
        out.set(base.id, {
          id: base.id,
          version: base.version,
          source: PROFILE_SOURCE.INHERITED,
          parameters: {},
          provenance: { sourceKind: "inherited", sourceRef: `catalog:${catalog.id}@${catalog.version}#/profiles/${profileId}/extends` },
          via: [...chain, base.id],
        });
      }
      visit(base.id, [...chain, base.id]);
    }
  };
  for (const p of declared) visit(p.id, [p.id]);
  return [...out.values()].sort((a, b) => compareIds(a.id, b.id));
}

function rootStatus(repoRoot, unit) {
  if (!repoRoot) return { status: "unchecked" };
  const res = containReal(repoRoot, unit.root === "." ? repoRoot : unit.root);
  if (res.escape) {
    raise("UNIT_ROOT_OUTSIDE_REPO", `unidad ${unit.id}: el root resuelve fuera del repositorio`, {
      remediation: "Los roots deben quedar dentro del repo; no se siguen symlinks que escapan.",
    });
  }
  return { status: fs.existsSync(path.join(repoRoot, unit.root)) ? "present" : "missing" };
}

function isAncestorOrSame(a, b) {
  if (a === ".") return true;
  return b === a || b.startsWith(`${a}/`);
}

/**
 * @param {object} resolvedConfig  Salida de `resolveEngineeringConfig`.
 * @param {object} snapshot        Snapshot de catálogo de la ejecución.
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 */
function resolveUnits(resolvedConfig, snapshot, opts = {}) {
  const { catalog } = snapshot;
  if (resolvedConfig.catalog.digest !== snapshot.ref.digest) {
    raise("CATALOG_MIXED_VERSIONS", "la config se resolvió contra otro catálogo que el de la ejecución");
  }
  const diagnostics = [];
  const entries = resolvedConfig.effective.units;
  const index = createIdentityIndex(entries.map((e) => e.unit));

  const units = entries.map(({ unit, controls }) => {
    const root = rootStatus(opts.repoRoot, unit);
    if (root.status === "missing") diagnostics.push({ code: "UNIT_ROOT_MISSING", message: `unidad ${unit.id}: el root no existe en este checkout` });
    if (unit.profiles.length === 0) {
      diagnostics.push({ code: "UNIT_WITHOUT_PROFILES", message: `unidad ${unit.id} no declara perfiles: los controles dependientes de perfil no aplican` });
    }
    return {
      id: unit.id,
      root: unit.root,
      rootHash: unitRootHash(unit),
      rootStatus: root.status,
      kind: unit.kind,
      owns: [...unit.owns],
      excludes: [...unit.excludes],
      dependsOn: [...unit.dependsOn],
      identityAliases: [...unit.identityAliases],
      profiles: closeProfiles(unit.profiles, catalog, unit.id),
      controls,
    };
  });

  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      const a = units[i];
      const b = units[j];
      if (isAncestorOrSame(a.root, b.root) || isAncestorOrSame(b.root, a.root)) {
        diagnostics.push({
          code: "UNIT_ROOT_OVERLAP",
          message: `los roots de ${a.id} y ${b.id} se superponen; el ownership se decide por owns/excludes`,
        });
      }
    }
  }

  units.sort((a, b) => compareIds(a.id, b.id));
  return Object.freeze({
    catalog: deepFreeze({ ...snapshot.ref }),
    units: deepFreeze(units),
    diagnostics: deepFreeze(diagnostics),
    /** Resuelve id o alias gobernado → id estable (o null). */
    resolveId: index.resolve,
  });
}

/**
 * Estado de un perfil en una unidad, distinguiendo declarado de sugerido.
 * @param {object} unit         Unidad resuelta.
 * @param {string} profileId
 * @param {{unitId: string, profile: {id}}[]} [suggestions]  Salida de discovery.
 */
function profileStatus(unit, profileId, suggestions = []) {
  const p = unit.profiles.find((x) => x.id === profileId);
  if (p) return p.source === PROFILE_SOURCE.EXPLICIT ? PROFILE_STATUS.EXPLICIT : PROFILE_STATUS.INHERITED;
  if (suggestions.some((s) => s.unitId === unit.id && s.profile.id === profileId)) return PROFILE_STATUS.SUGGESTED;
  return PROFILE_STATUS.UNDECLARED;
}

/**
 * ¿La unidad declara los perfiles que exige un control? Sólo cuentan
 * `explicit`/`inherited`; un perfil sugerido nunca satisface (R2.2, R5.3).
 *
 * @returns {{satisfied: boolean, matched: {id, version, status}[], missing: {id, status}[]}}
 */
function profileRequirement(unit, control, suggestions = []) {
  const all = control.profiles.allOf || [];
  const any = control.profiles.anyOf || [];
  const status = (id) => profileStatus(unit, id, suggestions);
  const declared = (id) => [PROFILE_STATUS.EXPLICIT, PROFILE_STATUS.INHERITED].includes(status(id));
  const ref = (id) => {
    const p = unit.profiles.find((x) => x.id === id);
    return { id, version: p.version, status: status(id) };
  };
  const missing = all.filter((id) => !declared(id)).map((id) => ({ id, status: status(id) }));
  const anyMatched = any.filter(declared);
  if (any.length && anyMatched.length === 0) any.forEach((id) => missing.push({ id, status: status(id) }));
  const matched = [...all.filter(declared), ...anyMatched].map(ref);
  return { satisfied: missing.length === 0, matched, missing };
}

module.exports = { PROFILE_STATUS, closeProfiles, resolveUnits, profileStatus, profileRequirement };
