"use strict";

// T04: perfiles funcionales, unidades explícitas y discovery sólo sugerente.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveEngineeringConfig } = require("../../../src/engineering/guardrails/config/index.js");
const { resolveCatalog } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { resolveUnits, profileStatus, profileRequirement, PROFILE_STATUS } = require("../../../src/engineering/guardrails/workspace/units.js");
const { createIdentityIndex, unitRootHash } = require("../../../src/engineering/guardrails/workspace/identity.js");
const { discoverProfiles } = require("../../../src/engineering/guardrails/workspace/discover.js");
const H = require("../helpers/catalogs.js");

function doc(units, extra = {}) {
  return { schemaVersion: 1, pack: { id: "engineering/guardrails", catalog: extra.catalog || "1.0.0" }, workspace: { units, ...(extra.workspace || {}) } };
}

function unitDecl(id, root, profiles, extra = {}) {
  return { id, root, kind: "application", profiles: profiles.map((p) => ({ id: p, version: "1.0.0" })), owns: [`${root === "." ? "**" : `${root}/**`}`], ...extra };
}

function resolveAll(d, opts = {}) {
  const catalogOptions = opts.catalogOptions || {};
  const cfg = resolveEngineeringConfig({ document: d, env: {}, catalogOptions });
  const snap = resolveCatalog({ ...catalogOptions, version: d.pack.catalog });
  return { cfg, snap, resolved: resolveUnits(cfg, snap, { repoRoot: opts.repoRoot }) };
}

/** Catálogo 1.1.0 con perfiles compuestos (mutación arbitraria del doc). */
function withCatalog(mutate, fn) {
  const dir = H.tmpDir();
  try {
    const root = H.writeCatalog(dir, H.buildFiles((d) => {
      d.version = "1.1.0";
      mutate(d);
    }));
    return fn({ roots: [root] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SEARCH = () => resolveCatalog({ version: "1.0.0" }).catalog.controls.find((c) => c.id === "search.input-rate");
const ANNOUNCE = () => resolveCatalog({ version: "1.0.0" }).catalog.controls.find((c) => c.id === "web.module-announcement");

// --- T04.1 ---------------------------------------------------------------

test("T04.1 perfiles builtin por unidad; cada unidad conserva los suyos", () => {
  const { resolved } = resolveAll(
    doc([
      unitDecl("acme/web", "apps/web", ["web", "search", "module-launch"]),
      unitDecl("acme/mobile", "apps/mobile", ["mobile-app"]),
    ])
  );
  const web = resolved.units.find((u) => u.id === "acme/web");
  const mobile = resolved.units.find((u) => u.id === "acme/mobile");
  assert.deepEqual(web.profiles.map((p) => p.id), ["module-launch", "search", "web"]);
  assert.deepEqual(mobile.profiles.map((p) => p.id), ["mobile-app"]);
  assert.equal(profileRequirement(web, ANNOUNCE()).satisfied, true);
  assert.equal(profileRequirement(mobile, ANNOUNCE()).satisfied, false);
  assert.ok(web.controls["search.input-rate"], "la unidad lleva sus controles efectivos de T03");
});

test("T04.1 perfil namespaceado extensible publicado en catálogo, con herencia compuesta", () => {
  withCatalog(
    (d) => {
      d.profiles.push({ id: "acme/checkout", version: "1.0.0", description: "Checkout web", extends: [{ id: "web", version: "1.0.0" }, { id: "search", version: "1.0.0" }] });
    },
    (catalogOptions) => {
      const { resolved } = resolveAll(doc([unitDecl("acme/shop", "apps/shop", ["acme/checkout"])], { catalog: "1.1.0" }), { catalogOptions });
      const shop = resolved.units[0];
      assert.deepEqual(shop.profiles.map((p) => `${p.id}:${p.source}`), ["acme/checkout:explicit", "search:inherited", "web:inherited"]);
      assert.deepEqual(shop.profiles.find((p) => p.id === "web").via, ["acme/checkout", "web"]);
      assert.equal(profileStatus(shop, "web"), PROFILE_STATUS.INHERITED);
      assert.equal(profileRequirement(shop, SEARCH()).satisfied, true);
    }
  );
});

// --- T04.2 ---------------------------------------------------------------

function discoveryRepo(fn) {
  const dir = fs.realpathSync(H.tmpDir("kiritek-eng-disc-"));
  const outside = H.tmpDir("kiritek-eng-out-");
  try {
    const w = (rel, content) => {
      const abs = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    w("apps/web/package.json", JSON.stringify({ dependencies: { react: "18.0.0", algoliasearch: "4.0.0" } }));
    w("apps/web/public/index.html", "<html></html>");
    w("apps/mobile/pubspec.yaml", "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n");
    fs.mkdirSync(path.join(dir, "apps/mobile/android"), { recursive: true });
    fs.mkdirSync(path.join(dir, "apps/mobile/ios"), { recursive: true });
    w("node_modules/next/package.json", JSON.stringify({ dependencies: { next: "1" } }));
    w("apps/broken/package.json", "{ no es json");
    fs.writeFileSync(path.join(outside, "package.json"), JSON.stringify({ dependencies: { vue: "3" } }));
    fs.symlinkSync(outside, path.join(dir, "apps", "linked"));
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

test("T04.2 discovery sólo sugiere con confianza low/medium y razones", () => {
  discoveryRepo((dir) => {
    const { catalog } = resolveCatalog({ version: "1.0.0" });
    const out = discoverProfiles(dir, { catalog });
    const keys = out.suggestions.map((s) => `${s.root}:${s.profile.id}:${s.confidence}`);
    assert.ok(keys.includes("apps/web:web:medium"));
    assert.ok(keys.includes("apps/web:search:low"));
    assert.ok(keys.includes("apps/mobile:mobile-app:medium"));
    assert.equal(keys.some((k) => k.startsWith("node_modules")), false, "no recorre node_modules");
    assert.equal(keys.some((k) => k.includes(":web:") && k.startsWith("apps/linked")), false, "no sigue symlinks");
    for (const s of out.suggestions) {
      assert.ok(["low", "medium"].includes(s.confidence), "nunca high/deterministic");
      assert.equal(s.profile.source, "suggested");
      assert.ok(s.reasons.length > 0);
      assert.equal(s.requiresAcceptance, true);
      for (const k of ["level", "enforce", "decision", "controls"]) assert.equal(k in s, false);
    }
    const mobile = out.suggestions.find((s) => s.root === "apps/mobile");
    assert.ok(mobile.reasons.some((r) => r.code === "DEPENDENCY_DETECTED") && mobile.reasons.some((r) => r.code === "PLATFORM_DIRECTORY"));
    assert.ok(out.diagnostics.some((d) => d.code === "DISCOVERY_MANIFEST_UNREADABLE"));
    const serialized = JSON.stringify(out);
    assert.equal(serialized.includes(dir), false, "sin rutas absolutas");
    assert.equal(serialized.includes("18.0.0"), false, "no copia versiones ni contenido de manifests");
  });
});

test("T04.2 sugerencias no activan perfiles ni enforcement", () => {
  discoveryRepo((dir) => {
    const d = doc([unitDecl("acme/web", "apps/web", ["web"])]);
    const before = resolveAll(d, { repoRoot: dir });
    const out = discoverProfiles(dir, { catalog: before.snap.catalog, units: before.resolved.units });
    const searchSug = out.suggestions.find((s) => s.profile.id === "search");
    assert.equal(searchSug.unitId, "acme/web");
    assert.equal(out.suggestions.find((s) => s.profile.id === "web" && s.unitId === "acme/web").alreadyDeclared, true);
    const after = resolveAll(d, { repoRoot: dir });
    assert.equal(after.cfg.configHash, before.cfg.configHash);
    const web = after.resolved.units[0];
    assert.equal(profileStatus(web, "search", out.suggestions), PROFILE_STATUS.SUGGESTED);
    const req = profileRequirement(web, SEARCH(), out.suggestions);
    assert.equal(req.satisfied, false, "un perfil sugerido nunca satisface aplicabilidad");
    assert.deepEqual(req.missing, [{ id: "search", status: "suggested" }]);
  });
});

// --- T04.3 ---------------------------------------------------------------

test("T04.3 ciclos de perfiles e incompatibilidad de versión fallan", () => {
  withCatalog(
    (d) => {
      d.profiles.find((p) => p.id === "web").extends = [{ id: "module-launch", version: "1.0.0" }];
      d.profiles.find((p) => p.id === "module-launch").extends = [{ id: "web", version: "1.0.0" }];
    },
    (catalogOptions) => {
      assert.throws(() => resolveAll(doc([unitDecl("acme/web", "apps/web", ["web"])], { catalog: "1.1.0" }), { catalogOptions }), { code: "PROFILE_CYCLE" });
    }
  );
  withCatalog(
    (d) => {
      d.profiles.find((p) => p.id === "module-launch").extends = [{ id: "web", version: "2.0.0" }];
    },
    (catalogOptions) => {
      assert.throws(() => resolveAll(doc([unitDecl("acme/web", "apps/web", ["module-launch"])], { catalog: "1.1.0" }), { catalogOptions }), { code: "PROFILE_INCOMPATIBLE" });
    }
  );
});

test("T04.3 IDs estables, aliases gobernados y rootHash", () => {
  const { resolved } = resolveAll(doc([unitDecl("acme/web", "apps/web", ["web"], { identityAliases: ["acme/web-legacy"] })]));
  assert.deepEqual(resolved.resolveId("acme/web-legacy"), { id: "acme/web", via: "alias" });
  assert.deepEqual(resolved.resolveId("acme/web"), { id: "acme/web", via: "id" });
  assert.equal(resolved.resolveId("acme/otro"), null);
  assert.throws(
    () => createIdentityIndex([{ id: "a/x", identityAliases: ["a/old"] }, { id: "a/y", identityAliases: ["a/old"] }]),
    { code: "IDENTITY_CONFLICT" }
  );
  const moved = unitRootHash({ id: "acme/web", root: "apps/web2" });
  assert.notEqual(moved, resolved.units[0].rootHash, "mover el root cambia rootHash (invalida evidencia)");
  assert.equal(unitRootHash({ id: "acme/web", root: "apps/web" }), resolved.units[0].rootHash);
});

test("T04.3 roots confinados: symlink que escapa se rechaza", () => {
  const dir = fs.realpathSync(H.tmpDir("kiritek-eng-units-"));
  const outside = H.tmpDir("kiritek-eng-out-");
  try {
    fs.mkdirSync(path.join(dir, "apps"));
    fs.symlinkSync(outside, path.join(dir, "apps", "web"));
    const d = doc([unitDecl("acme/web", "apps/web", ["web"])]);
    const cfg = resolveEngineeringConfig({ document: d, env: {} });
    assert.throws(() => resolveUnits(cfg, resolveCatalog({ version: "1.0.0" }), { repoRoot: dir }), { code: "UNIT_ROOT_OUTSIDE_REPO" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("T04.3 resolver unidades con otro catálogo que el de la config es error", () => {
  withCatalog(() => {}, (catalogOptions) => {
    const cfg = resolveEngineeringConfig({ document: doc([unitDecl("acme/web", "apps/web", ["web"])]), env: {} });
    const other = resolveCatalog({ ...catalogOptions, version: "1.1.0" });
    assert.throws(() => resolveUnits(cfg, other), { code: "CATALOG_MIXED_VERSIONS" });
  });
});

// --- T04.4 / T04.5 -------------------------------------------------------

test("T04.4 distingue no declarado, sugerido, heredado y explícito", () => {
  const { resolved } = resolveAll(
    doc([unitDecl("acme/web", "apps/web", ["web"])], { workspace: { inheritProfiles: true, profiles: [{ id: "module-launch", version: "1.0.0" }] } })
  );
  const web = resolved.units[0];
  const suggestions = [{ unitId: "acme/web", profile: { id: "search" } }];
  assert.equal(profileStatus(web, "web", suggestions), "explicit");
  assert.equal(profileStatus(web, "module-launch", suggestions), "inherited");
  assert.equal(profileStatus(web, "search", suggestions), "suggested");
  assert.equal(profileStatus(web, "mobile-app", suggestions), "undeclared");
});

test("T04.5 repo sin perfiles: controles dependientes no aplican y se diagnostica", () => {
  const { resolved } = resolveAll(doc([unitDecl("acme/docs", "docs", [])]));
  const unit = resolved.units[0];
  assert.deepEqual(unit.profiles, []);
  assert.ok(resolved.diagnostics.some((d) => d.code === "UNIT_WITHOUT_PROFILES"));
  const req = profileRequirement(unit, SEARCH());
  assert.equal(req.satisfied, false);
  assert.deepEqual(req.missing, [{ id: "search", status: "undeclared" }]);
  const empty = resolveAll(doc([]));
  assert.deepEqual(empty.resolved.units, []);
});

test("T04.5 unidades superpuestas se diagnostican; rutas Unicode/espacios funcionan", () => {
  const dir = fs.realpathSync(H.tmpDir("kiritek-eng-units-"));
  try {
    fs.mkdirSync(path.join(dir, "apps", "búsqueda web"), { recursive: true });
    const { resolved } = resolveAll(
      doc([
        unitDecl("acme/root", ".", [], { kind: "workspace", owns: ["*.json"] }),
        unitDecl("acme/busqueda", "apps/búsqueda web", ["web", "search"]),
        unitDecl("acme/nested", "apps/búsqueda web/admin", ["web"]),
      ]),
      { repoRoot: dir }
    );
    const overlaps = resolved.diagnostics.filter((d) => d.code === "UNIT_ROOT_OVERLAP");
    assert.equal(overlaps.length, 3);
    assert.equal(resolved.units.find((u) => u.id === "acme/busqueda").rootStatus, "present");
    assert.equal(resolved.units.find((u) => u.id === "acme/nested").rootStatus, "missing");
    assert.ok(resolved.diagnostics.some((d) => d.code === "UNIT_ROOT_MISSING"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T04.5 salida congelada y determinista (orden por id estable)", () => {
  const a = resolveAll(doc([unitDecl("acme/z", "z", ["web"]), unitDecl("acme/a", "a", ["search", "web"])])).resolved;
  const b = resolveAll(doc([unitDecl("acme/a", "a", ["web", "search"]), unitDecl("acme/z", "z", ["web"])])).resolved;
  assert.deepEqual(a.units.map((u) => u.id), ["acme/a", "acme/z"]);
  assert.deepEqual(JSON.parse(JSON.stringify(a.units[0].profiles)).map((p) => p.id), JSON.parse(JSON.stringify(b.units[0].profiles)).map((p) => p.id));
  assert.ok(Object.isFrozen(a.units[0].profiles));
});
