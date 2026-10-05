"use strict";

/**
 * Alcance multiunidad por momento (T05.2–T05.4; design §7).
 *
 * - agent: paths de la operación propuesta.
 * - pre-commit: staged exacto.
 * - pr: rango completo + impacto por dependencias.
 * - release: unidades seleccionadas (o por alias gobernado) + sus
 *   dependencias de artefacto, aunque no estén en el diff.
 *
 * Reglas: cada path tiene dueño o diagnóstico; un path compartido sin dueño
 * es ambiguo ⇒ `expand` evalúa todas las unidades o `require-explicit`
 * falla. Nunca se reduce cobertura en silencio y la ambigüedad nunca produce
 * conformidad: las unidades expandidas se marcan `coverage: "expanded"`.
 */

const { containRelative } = require("../../../platform/paths.js");
const { MOMENT, deepFreeze } = require("../contracts/common.js");
const { hashJson } = require("../canonical.js");
const { raise } = require("../errors.js");
const { ownersOf, PATH_STATUS } = require("./ownership.js");
const { buildImpactGraph } = require("./impact-graph.js");
const { collectStaged, collectRange, headCommit } = require("./git-scope.js");
const { compareIds } = require("./identity.js");

const COVERAGE = Object.freeze({
  DIRECT: "direct",
  SELECTED: "selected",
  ARTIFACT_DEPENDENCY: "artifact-dependency",
  DEPENDENCY: "dependency",
  EXPANDED: "expanded",
});
const COVERAGE_RANK = Object.freeze({ direct: 5, selected: 4, "artifact-dependency": 3, dependency: 2, expanded: 1 });

function classifyPath(relPath, units, sharedPaths) {
  try {
    return ownersOf(relPath, units, sharedPaths);
  } catch (err) {
    // Nombre no representable como ruta segura: se trata como compartido
    // (expande) en lugar de descartarlo.
    return { path: relPath, status: PATH_STATUS.SHARED, owners: [], excludedBy: [], sharedReason: "unsupported-path-name" };
  }
}

/**
 * Impacto puro a partir de cambios ya colectados.
 *
 * @param {object} args
 * @param {{path, change?, oldPath?}[]} args.changes
 * @param {object[]} args.units            Unidades resueltas (T04).
 * @param {"expand"|"require-explicit"} args.policy
 * @param {string[]} [args.sharedPaths]
 * @param {string[]} [args.selectedUnits]  release: ids o aliases.
 * @param {(x: string) => ({id, via}|null)} [args.resolveId]
 */
function resolveImpact(args) {
  const units = args.units;
  const graph = buildImpactGraph(units);
  const sharedPaths = args.sharedPaths || [];
  const impacted = new Map(); // id → { coverage, reasons:Set, paths:Set }
  const diagnostics = [];
  const add = (id, coverage, reason, path) => {
    if (!impacted.has(id)) impacted.set(id, { coverage, reasons: new Set(), paths: new Set() });
    const e = impacted.get(id);
    if (COVERAGE_RANK[coverage] > COVERAGE_RANK[e.coverage]) e.coverage = coverage;
    e.reasons.add(reason);
    if (path) e.paths.add(path);
  };

  const pathReports = [];
  const ambiguousPaths = [];
  for (const change of args.changes || []) {
    const candidates = [{ p: change.path, role: "path" }];
    if (change.oldPath && change.oldPath !== change.path) candidates.push({ p: change.oldPath, role: "rename-source" });
    for (const { p, role } of candidates) {
      const report = classifyPath(p, units, sharedPaths);
      pathReports.push({ ...report, change: change.change || null, role });
      if (report.status === PATH_STATUS.OWNED) {
        for (const o of report.owners) add(o.unitId, COVERAGE.DIRECT, role === "rename-source" ? `${o.reason} (origen de rename)` : o.reason, p);
      } else if (report.status === PATH_STATUS.SHARED) {
        ambiguousPaths.push({ path: p, reason: report.sharedReason });
      } else {
        diagnostics.push({ code: "UNOWNED_PATH", message: `${p} no pertenece a ninguna unidad ni a sharedPaths`, remediation: "Declare un owner o agréguelo a workspace.sharedPaths." });
      }
    }
  }

  if (ambiguousPaths.length) {
    if (args.policy === "require-explicit") {
      raise("SCOPE_AMBIGUOUS", `${ambiguousPaths.length} path(s) compartidos sin owner explícito (p. ej. ${ambiguousPaths[0].path})`, {
        remediation: "Declare ownership/dependencias explícitas o use onAmbiguousImpact: expand.",
      });
    }
    for (const u of units) {
      for (const a of ambiguousPaths) add(u.id, COVERAGE.EXPANDED, `scope-expanded:${a.reason}`, a.path);
    }
    diagnostics.push({ code: "SCOPE_EXPANDED", message: `${ambiguousPaths.length} path(s) compartidos: se evalúan todas las unidades` });
  }

  if (args.selectedUnits) {
    if (args.selectedUnits.length === 0) {
      raise("SCOPE_RELEASE_SELECTION_REQUIRED", "release requiere al menos una unidad seleccionada", { remediation: "Use --unit=<id>." });
    }
    const selected = [];
    for (const sel of args.selectedUnits) {
      const r = args.resolveId ? args.resolveId(sel) : units.some((u) => u.id === sel) ? { id: sel, via: "id" } : null;
      if (!r) raise("SCOPE_UNKNOWN_UNIT", `unidad seleccionada desconocida "${sel}"`);
      add(r.id, COVERAGE.SELECTED, r.via === "alias" ? `selected:alias:${sel}` : "selected", null);
      selected.push(r.id);
    }
    for (const dep of graph.transitiveDependencies(selected)) add(dep, COVERAGE.ARTIFACT_DEPENDENCY, "artifact-dependency", null);
  }

  const direct = [...impacted.entries()].filter(([, e]) => e.coverage === COVERAGE.DIRECT).map(([id]) => id);
  // Por unidad directa: una unidad cambiada que además depende de otra
  // cambiada conserva ambas razones.
  for (const id of direct) {
    for (const dep of graph.transitiveDependents([id])) add(dep, COVERAGE.DEPENDENCY, "transitive-dependent", null);
  }

  const cycles = graph.cycles();
  if (cycles.length) diagnostics.push({ code: "SCOPE_DEPENDENCY_CYCLE", message: `ciclos evaluados como componente: ${cycles.map((c) => c.join(" ↔ ")).join("; ")}` });

  const unitsOut = [...impacted.entries()]
    .map(([unitId, e]) => ({
      unitId,
      coverage: e.coverage,
      reasons: [...e.reasons].sort(compareIds),
      paths: [...e.paths].sort(compareIds),
    }))
    .sort((a, b) => compareIds(a.unitId, b.unitId));

  return {
    units: unitsOut,
    paths: pathReports,
    ambiguous: ambiguousPaths.length > 0,
    components: graph.components,
    diagnostics,
  };
}

function scopeHashFor({ moment, revision, baseRevision, artifactRef, unit }) {
  return hashJson({
    moment,
    revision,
    baseRevision: baseRevision || null,
    artifactRef: artifactRef || null,
    unitId: unit.unitId,
    coverage: unit.coverage,
    reasons: unit.reasons,
    paths: unit.paths,
  });
}

/**
 * Clave de partición de cache/evidencia/waiver/N-A (T05.4): nunca se
 * comparte entre unidades, versiones de control/perfil ni catálogos.
 */
function partitionKey({ unitId, controlId, controlVersion, profileRefs, catalogDigest }) {
  const profiles = [...(profileRefs || [])].map((p) => `${p.id}@${p.version}`).sort(compareIds);
  const parts = { unitId, controlId, controlVersion, profiles, catalogDigest };
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === null || v === "") raise("SCOPE_PARTITION_INCOMPLETE", `partición sin ${k}`);
  }
  return { key: `${unitId}|${controlId}@${controlVersion}|${profiles.join(",")}|${catalogDigest}`, hash: hashJson(parts) };
}

/**
 * Resuelve el alcance completo de un momento.
 *
 * @param {object} input
 * @param {"agent"|"pre-commit"|"pr"|"release"} input.moment
 * @param {string} input.repoRoot
 * @param {{units, resolveId}} input.resolvedUnits  Salida de `resolveUnits`.
 * @param {{sharedPaths, onAmbiguousImpact}} input.workspace  Config efectiva.
 * @param {string} [input.base] / [input.head]   pr
 * @param {string[]} [input.agentPaths]         agent
 * @param {string[]} [input.selectedUnits]      release
 * @param {string} [input.artifactRef]          release
 */
function resolveScope(input) {
  const { moment, repoRoot } = input;
  let collected;
  if (moment === MOMENT.PRE_COMMIT) {
    collected = collectStaged(repoRoot);
  } else if (moment === MOMENT.PR) {
    if (!input.base || !input.head) raise("SCOPE_RANGE_REQUIRED", "pr requiere base y head", { remediation: "Pase --base y --revision/--range." });
    collected = collectRange(repoRoot, input.base, input.head);
  } else if (moment === MOMENT.AGENT) {
    const entries = (input.agentPaths || []).map((p) => {
      try {
        return { change: "M", path: containRelative(repoRoot, p) };
      } catch (err) {
        raise("SCOPE_PATH_OUTSIDE_REPO", "la operación propuesta apunta fuera del repositorio");
      }
    });
    collected = { entries, revision: headCommit(repoRoot) || null };
  } else if (moment === MOMENT.RELEASE) {
    const head = input.head || headCommit(repoRoot);
    if (!head) raise("SCOPE_RANGE_REQUIRED", "release requiere una revisión");
    collected = { entries: [], revision: head };
  } else {
    raise("SCOPE_INVALID_MOMENT", `momento desconocido ${moment}`);
  }
  if (!collected.revision) raise("SCOPE_NO_REVISION", "no hay revisión (repositorio sin commits)", { remediation: "Haga al menos un commit." });

  const impact = resolveImpact({
    changes: collected.entries,
    units: input.resolvedUnits.units,
    policy: input.workspace.onAmbiguousImpact,
    sharedPaths: input.workspace.sharedPaths,
    selectedUnits: moment === MOMENT.RELEASE ? input.selectedUnits || [] : undefined,
    resolveId: input.resolvedUnits.resolveId,
  });
  const diagnostics = [...impact.diagnostics];
  if (collected.shallow) diagnostics.push({ code: "SCOPE_SHALLOW", message: "repositorio shallow: rango verificado con merge-base disponible" });

  const units = impact.units.map((u) => ({
    ...u,
    scopeHash: scopeHashFor({ moment, revision: collected.revision, baseRevision: collected.baseRevision, artifactRef: input.artifactRef, unit: u }),
  }));

  return deepFreeze({
    moment,
    revision: collected.revision,
    baseRevision: collected.baseRevision || null,
    mergeBase: collected.mergeBase || null,
    tree: collected.tree || null,
    artifactRef: input.artifactRef || null,
    changes: collected.entries,
    paths: impact.paths,
    units,
    ambiguous: impact.ambiguous,
    components: impact.components,
    diagnostics,
  });
}

module.exports = { COVERAGE, resolveImpact, resolveScope, scopeHashFor, partitionKey };
