"use strict";

// T05: ownership, grafo de impacto y alcance multiunidad.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveEngineeringConfig } = require("../../../src/engineering/guardrails/config/index.js");
const { resolveCatalog } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { resolveUnits } = require("../../../src/engineering/guardrails/workspace/units.js");
const { ownersOf } = require("../../../src/engineering/guardrails/workspace/ownership.js");
const { buildImpactGraph } = require("../../../src/engineering/guardrails/workspace/impact-graph.js");
const { resolveImpact, resolveScope, partitionKey } = require("../../../src/engineering/guardrails/workspace/scope.js");
const G = require("../helpers/git.js");

const SNAP = resolveCatalog({ version: "1.0.0" });

function unit(id, root, extra = {}) {
  return { id, root, kind: "application", profiles: [{ id: "web", version: "1.0.0" }], owns: [`${root}/**`], ...extra };
}

/** Monorepo: web y mobile dependen de ui; tooling compartido. */
function monorepoDoc(policy = "expand") {
  return {
    schemaVersion: 1,
    pack: { id: "engineering/guardrails", catalog: "1.0.0" },
    workspace: {
      sharedPaths: ["tooling/**"],
      onAmbiguousImpact: policy,
      units: [
        unit("acme/web", "apps/web", { dependsOn: ["acme/ui"], excludes: ["apps/web/fixtures/**"], identityAliases: ["acme/site"] }),
        unit("acme/mobile", "apps/mobile", { dependsOn: ["acme/ui"] }),
        unit("acme/ui", "packages/ui"),
        unit("acme/busqueda", "apps/búsqueda web"),
      ],
    },
  };
}

function setup(doc = monorepoDoc(), repoRoot) {
  const cfg = resolveEngineeringConfig({ document: doc, env: {} });
  return { cfg, resolvedUnits: resolveUnits(cfg, SNAP, { repoRoot }), workspace: cfg.effective.workspace };
}

function impact(paths, doc) {
  const { resolvedUnits, workspace } = setup(doc);
  return resolveImpact({
    changes: paths.map((p) => (typeof p === "string" ? { change: "M", path: p } : p)),
    units: resolvedUnits.units,
    policy: workspace.onAmbiguousImpact,
    sharedPaths: workspace.sharedPaths,
    resolveId: resolvedUnits.resolveId,
  });
}

const byId = (r) => Object.fromEntries(r.units.map((u) => [u.unitId, u]));

// --- T05.1 ---------------------------------------------------------------

test("T05.1 ownership por owns/excludes con razones; shared y root-level", () => {
  const units = setup().resolvedUnits.units;
  const owned = ownersOf("apps/web/src/a.ts", units, ["tooling/**"]);
  assert.deepEqual(owned.owners, [{ unitId: "acme/web", reason: "owns:apps/web/**" }]);
  const excluded = ownersOf("apps/web/fixtures/x.json", units, []);
  assert.equal(excluded.status, "unowned");
  assert.deepEqual(excluded.excludedBy, [{ unitId: "acme/web", reason: "excludes:apps/web/fixtures/**" }]);
  assert.equal(ownersOf("tooling/eslint.js", units, ["tooling/**"]).sharedReason, "sharedPaths:tooling/**");
  assert.equal(ownersOf("package-lock.json", units, []).status, "shared");
  assert.equal(ownersOf("docs/readme.md", units, []).status, "unowned");
  assert.throws(() => ownersOf("/etc/passwd", units, []));
});

test("T05.1 paths con dueño directo, dependientes transitivos y razones preservadas", () => {
  const r = impact(["packages/ui/button.tsx"]);
  const u = byId(r);
  assert.equal(u["acme/ui"].coverage, "direct");
  assert.equal(u["acme/web"].coverage, "dependency");
  assert.equal(u["acme/mobile"].coverage, "dependency");
  assert.deepEqual(u["acme/web"].reasons, ["transitive-dependent"]);
  assert.equal(u["acme/busqueda"], undefined, "no se expande sin motivo");
});

// --- T05.2 ---------------------------------------------------------------

test("T05.2 ciclos se evalúan como componente fuertemente conectado", () => {
  const g = buildImpactGraph([
    { id: "a/a", dependsOn: ["a/b"] },
    { id: "a/b", dependsOn: ["a/a"] },
    { id: "a/c", dependsOn: ["a/a"] },
    { id: "a/d", dependsOn: [] },
  ]);
  assert.deepEqual(g.cycles(), [["a/a", "a/b"]]);
  assert.deepEqual(g.transitiveDependents(["a/b"]), ["a/a", "a/c"]);
  assert.deepEqual(g.transitiveDependencies(["a/c"]), ["a/a", "a/b"]);
  assert.deepEqual(g.componentOf("a/d"), ["a/d"]);
});

test("T05.2 path compartido: expand evalúa todas las unidades; require-explicit falla", () => {
  const r = impact(["tooling/build.js", "apps/web/a.ts"]);
  const u = byId(r);
  assert.equal(r.ambiguous, true);
  assert.equal(u["acme/web"].coverage, "direct", "direct domina sobre expanded");
  for (const id of ["acme/mobile", "acme/ui", "acme/busqueda"]) {
    assert.equal(u[id].coverage, "expanded");
    assert.ok(u[id].reasons.includes("scope-expanded:sharedPaths:tooling/**"));
  }
  assert.ok(r.diagnostics.some((d) => d.code === "SCOPE_EXPANDED"));
  assert.throws(() => impact(["tooling/build.js"], monorepoDoc("require-explicit")), (err) => err.code === "SCOPE_AMBIGUOUS" && !!err.remediation);
  assert.equal(impact(["apps/web/a.ts"], monorepoDoc("require-explicit")).ambiguous, false);
});

test("T05.2 deduplica por id estable y fusiona razones", () => {
  const r = impact(["apps/web/a.ts", "apps/web/b.ts", "packages/ui/x.ts"]);
  const ids = r.units.map((x) => x.unitId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(byId(r)["acme/web"].paths, ["apps/web/a.ts", "apps/web/b.ts"]);
  assert.equal(byId(r)["acme/web"].coverage, "direct");
  assert.ok(byId(r)["acme/web"].reasons.includes("transitive-dependent"));
});

test("T05.2 release: unidades seleccionadas (o alias) + dependencias de artefacto", () => {
  const { resolvedUnits, workspace } = setup();
  const r = resolveImpact({
    changes: [],
    units: resolvedUnits.units,
    policy: workspace.onAmbiguousImpact,
    sharedPaths: workspace.sharedPaths,
    selectedUnits: ["acme/site"],
    resolveId: resolvedUnits.resolveId,
  });
  assert.deepEqual(r.units.map((u) => [u.unitId, u.coverage]), [["acme/ui", "artifact-dependency"], ["acme/web", "selected"]]);
  assert.ok(byId(r)["acme/web"].reasons.includes("selected:alias:acme/site"));
  assert.throws(() => resolveImpact({ changes: [], units: resolvedUnits.units, policy: "expand", selectedUnits: [] }), { code: "SCOPE_RELEASE_SELECTION_REQUIRED" });
  assert.throws(() => resolveImpact({ changes: [], units: resolvedUnits.units, policy: "expand", selectedUnits: ["acme/nope"], resolveId: resolvedUnits.resolveId }), { code: "SCOPE_UNKNOWN_UNIT" });
});

// --- T05.4 ---------------------------------------------------------------

test("T05.4 partición por unidad/control/versión/perfil/catálogo", () => {
  const base = { unitId: "acme/web", controlId: "search.input-rate", controlVersion: "1.0.0", profileRefs: [{ id: "search", version: "1.0.0" }, { id: "web", version: "1.0.0" }], catalogDigest: SNAP.ref.digest };
  const k = partitionKey(base);
  assert.equal(partitionKey({ ...base, profileRefs: [...base.profileRefs].reverse() }).hash, k.hash, "orden de perfiles irrelevante");
  for (const change of [{ unitId: "acme/mobile" }, { controlId: "web.module-announcement" }, { controlVersion: "1.0.1" }, { profileRefs: [{ id: "web", version: "1.0.0" }] }, { catalogDigest: `sha256:${"0".repeat(64)}` }]) {
    assert.notEqual(partitionKey({ ...base, ...change }).hash, k.hash, JSON.stringify(change));
  }
  assert.throws(() => partitionKey({ ...base, catalogDigest: undefined }), { code: "SCOPE_PARTITION_INCOMPLETE" });
});

// --- T05.3 / T05.5: integración Git ---------------------------------------

function monorepoGit() {
  const dir = G.initRepo();
  for (const rel of ["apps/web/a.ts", "apps/web/b.ts", "apps/mobile/m.dart", "packages/ui/button.tsx", "apps/búsqueda web/índice.ts", "tooling/build.js", "README.md"]) G.write(dir, rel);
  const base = G.commitAll(dir, "base");
  return { dir, base };
}

function scopeFor(dir, input, doc = monorepoDoc()) {
  const { resolvedUnits, workspace } = setup(doc, dir);
  return resolveScope({ repoRoot: dir, resolvedUnits, workspace, ...input });
}

test("T05.3 pre-commit evalúa sólo el staged exacto, nunca unstaged", () => {
  const { dir } = monorepoGit();
  try {
    G.write(dir, "apps/web/a.ts", "staged\n");
    G.git(dir, "add", "apps/web/a.ts");
    G.write(dir, "apps/mobile/m.dart", "unstaged\n");
    const s = scopeFor(dir, { moment: "pre-commit" });
    assert.deepEqual(s.changes, [{ change: "M", path: "apps/web/a.ts" }]);
    assert.deepEqual(s.units.map((u) => u.unitId), ["acme/web"]);
    assert.match(s.units[0].scopeHash, /^sha256:/);
    assert.ok(s.tree);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T05.3 pre-commit en repo sin commits usa el árbol del índice como revisión", () => {
  const dir = G.initRepo();
  try {
    G.write(dir, "packages/ui/x.tsx");
    G.git(dir, "add", "-A");
    const s = scopeFor(dir, { moment: "pre-commit" });
    assert.equal(s.revision, s.tree);
    assert.deepEqual(s.units.map((u) => [u.unitId, u.coverage]), [["acme/mobile", "dependency"], ["acme/ui", "direct"], ["acme/web", "dependency"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T05.3/T05.5 PR: rango completo desde merge-base, renames entre unidades, Unicode y espacios", () => {
  const { dir, base } = monorepoGit();
  try {
    G.git(dir, "checkout", "-q", "-b", "feature");
    G.write(dir, "apps/búsqueda web/índice.ts", "cambio\n");
    G.commitAll(dir, "c1");
    G.git(dir, "mv", "apps/web/b.ts", "apps/mobile/b.ts");
    const head = G.commitAll(dir, "c2");
    // main avanza después: no debe aparecer en el alcance del PR.
    G.git(dir, "checkout", "-q", "main");
    G.write(dir, "packages/ui/button.tsx", "main\n");
    const mainHead = G.commitAll(dir, "main");
    const s = scopeFor(dir, { moment: "pr", base: mainHead, head });
    assert.equal(s.mergeBase, base);
    assert.equal(s.revision, head);
    const u = byId(s);
    assert.deepEqual(Object.keys(u).sort(), ["acme/busqueda", "acme/mobile", "acme/web"]);
    assert.ok(u["acme/web"].reasons.some((r) => r.includes("origen de rename")));
    assert.ok(s.changes.some((c) => c.change === "R" && c.oldPath === "apps/web/b.ts" && c.path === "apps/mobile/b.ts"));
    assert.equal(u["acme/ui"], undefined, "cambios sólo en main no entran al PR");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T05.5 worktree enlazado resuelve alcance propio", () => {
  const { dir } = monorepoGit();
  const wt = path.join(fs.realpathSync(os.tmpdir()), `kiritek-eng-wt-${process.pid}-${Date.now()}`);
  try {
    G.git(dir, "worktree", "add", "-q", "-b", "wt", wt);
    G.write(wt, "apps/mobile/m.dart", "wt\n");
    G.git(wt, "add", "-A");
    const s = scopeFor(wt, { moment: "pre-commit" });
    assert.deepEqual(s.units.map((u) => u.unitId), ["acme/mobile"]);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T05.5 rangos incompletos o repos shallow fallan; nunca alcance vacío", () => {
  const { dir, base } = monorepoGit();
  const clone = path.join(fs.realpathSync(os.tmpdir()), `kiritek-eng-shallow-${process.pid}-${Date.now()}`);
  try {
    G.write(dir, "apps/web/a.ts", "x\n");
    const head = G.commitAll(dir, "c1");
    assert.throws(() => scopeFor(dir, { moment: "pr", base: "0".repeat(40), head }), { code: "SCOPE_RANGE_INCOMPLETE" });
    assert.throws(() => scopeFor(dir, { moment: "pr", base: "--output=/tmp/x", head }), { code: "SCOPE_INVALID_REVISION" });
    assert.throws(() => scopeFor(dir, { moment: "pr", head }), { code: "SCOPE_RANGE_REQUIRED" });

    G.git(os.tmpdir(), "clone", "-q", "--depth", "1", `file://${dir}`, clone);
    assert.throws(
      () => scopeFor(clone, { moment: "pr", base, head }),
      (err) => err.code === "SCOPE_RANGE_INCOMPLETE" && /shallow/.test(err.message) && /fetch/.test(err.remediation)
    );
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T05.3 agent normaliza paths propuestos y rechaza los externos; release por selección", () => {
  const { dir, base } = monorepoGit();
  try {
    const a = scopeFor(dir, { moment: "agent", agentPaths: [path.join(dir, "packages/ui/new.tsx"), "apps/web/a.ts"] });
    assert.deepEqual(a.changes.map((c) => c.path), ["packages/ui/new.tsx", "apps/web/a.ts"]);
    assert.equal(a.revision, base);
    assert.throws(() => scopeFor(dir, { moment: "agent", agentPaths: ["/etc/hosts"] }), { code: "SCOPE_PATH_OUTSIDE_REPO" });
    const r = scopeFor(dir, { moment: "release", selectedUnits: ["acme/mobile"], artifactRef: "builds/mobile-1.2.3" });
    assert.deepEqual(r.units.map((u) => [u.unitId, u.coverage]), [["acme/mobile", "selected"], ["acme/ui", "artifact-dependency"]]);
    assert.equal(r.artifactRef, "builds/mobile-1.2.3");
    assert.notEqual(r.units[0].scopeHash, scopeFor(dir, { moment: "release", selectedUnits: ["acme/mobile"], artifactRef: "builds/mobile-1.2.4" }).units[0].scopeHash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- T05.6 gate ----------------------------------------------------------

test("T05.6 gate: cada path tiene owner o diagnóstico; ambigüedad nunca produce conformidad ni deny", () => {
  const pool = ["apps/web/a.ts", "apps/web/fixtures/f.json", "apps/mobile/m.dart", "packages/ui/x.ts", "tooling/t.js", "package.json", "docs/readme.md", "apps/búsqueda web/q.ts", "misc/other.txt"];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let iter = 0; iter < 200; iter += 1) {
    const paths = pool.filter(() => rand() < 0.4);
    const r = impact(paths);
    for (const report of r.paths) {
      if (report.status === "owned") assert.ok(report.owners.length > 0);
      else if (report.status === "shared") assert.equal(r.ambiguous, true);
      else assert.ok(r.diagnostics.some((d) => d.code === "UNOWNED_PATH" && d.message.startsWith(report.path)), report.path);
    }
    const serialized = JSON.stringify(r);
    for (const forbidden of ['"decision"', '"deny"', '"allow"', '"blockingEligible"', '"conform']) {
      assert.equal(serialized.includes(forbidden), false, `el alcance no decide (${forbidden})`);
    }
    if (r.ambiguous) {
      // Expansión: nunca se reduce cobertura y lo expandido no se marca como directo.
      assert.equal(r.units.length, 4);
      for (const u of r.units) if (!u.reasons.some((x) => x.startsWith("owns:"))) assert.notEqual(u.coverage, "direct");
      assert.throws(() => impact(paths, monorepoDoc("require-explicit")), { code: "SCOPE_AMBIGUOUS" });
    }
  }
});
