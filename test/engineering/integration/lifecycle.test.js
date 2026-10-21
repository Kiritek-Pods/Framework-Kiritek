"use strict";

// T15C: update / migrate / uninstall transaccionales, compatibilidad y matriz
// smoke con fallos inyectados.

const test = require("node:test");
const assert = require("node:assert/strict");
const { POSIX_ONLY, NEEDS_SANDBOX } = require("../helpers/platform.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

require("../helpers/git-isolation.js").isolateGit();

const { CONFIG, git, write, makeRepo, runCli } = require("../helpers/surfaces-repo.js");
const H = require("../helpers/catalogs.js");
const { BUILTIN_ROOT } = require("../../../src/engineering/guardrails/catalog/registry.js");
const gitAdapter = require("../../../src/engineering/guardrails/adapters/git.js");
const surfacesInstall = require("../../../src/engineering/guardrails/adapters/install.js");
const { platformCapabilities, MATRIX } = require("../../../src/engineering/guardrails/compatibility.js");
const { WIRING } = require("../../../src/engineering/guardrails/install/lifecycle.js");

const ANNOUNCE = "web.module-announcement";
const clean = (d) => fs.rmSync(d, { recursive: true, force: true });

// Catálogos de prueba: 1.4.0 (anuncio off por defecto) → 1.5.0 (anuncio warn
// por defecto + control nuevo web.extra-check).
let roots = null;
function catalogOptions() {
  if (!roots) {
    const dir = H.tmpDir("kiritek-eng-life-cat-");
    H.writeCatalog(dir, H.buildFiles((d) => {
      d.version = "1.4.0";
      d.controls.find((c) => c.id === ANNOUNCE).defaults.level = "off";
    }));
    H.writeCatalog(dir, H.buildFiles((d) => {
      d.version = "1.5.0";
      const ann = d.controls.find((c) => c.id === ANNOUNCE);
      d.controls.push({ ...JSON.parse(JSON.stringify(ann)), id: "web.extra-check", collectors: ["web-extra-check/collector"], normalizer: "web-extra-check/normalizer", applicability: "web-extra-check/applicability", evaluator: "web-extra-check/evaluator", documentationRef: "docs/engineering/controls/web-extra-check.md" });
    }));
    roots = [dir];
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return { roots: [...roots, BUILTIN_ROOT] };
}

function setCatalog(repo, version, mutate = () => {}) {
  const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
  doc.pack.catalog = version;
  delete doc.workspace.units[0].controls[ANNOUNCE];
  mutate(doc);
  write(repo, CONFIG, JSON.stringify(doc, null, 2));
}

/** Huella de todos los archivos (contenido + modo), excluyendo backups. */
function tree(dir, extra = []) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = path.relative(dir, abs);
      if (rel === ".git" || rel.startsWith(`.kiritek${path.sep}backups`)) continue;
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out[rel] = `${(fs.statSync(abs).mode & 0o777).toString(8)}:${crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 16)}`;
    }
  };
  walk(dir);
  for (const f of extra) out[f] = fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16) : "absent";
  return out;
}

const deps = (extra = {}) => ({ catalogOptions: catalogOptions(), ...extra });

// --- T15C.1 / T15C.2 update ---------------------------------------------------------------

test("T15C.1 update dry-run: diff de catálogo, gates nuevos off y niveles fijados; no muta nada", async () => {
  const { repo } = makeRepo();
  try {
    setCatalog(repo, "1.4.0");
    await runCli(["install"], repo, deps());
    const before = tree(repo);
    const r = await runCli(["update", "--to=1.5.0", "--dry-run"], repo, deps());
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.catalog.newGates, ["web.extra-check"]);
    assert.deepEqual(r.json.catalog.diff.controls.added, ["web.extra-check"]);
    assert.ok(r.json.catalog.pinned.some((p) => p.controlId === ANNOUNCE && p.kept === "off" && p.wouldBe === "warn"), JSON.stringify(r.json.catalog.pinned));
    assert.deepEqual(r.json.catalog.levelChanges.filter((c) => c.from !== null && c.from !== c.to), [], "ningún par existente cambia de nivel");
    assert.deepEqual(tree(repo), before, "dry-run no muta");
  } finally {
    clean(repo);
  }
});

test("T15C.2 update aplicado: no promueve en silencio; reentrante e idempotente", { skip: POSIX_ONLY }, async () => {
  const { repo, base, head } = makeRepo();
  try {
    setCatalog(repo, "1.4.0");
    await runCli(["install", "--surfaces=git,kiro"], repo, deps());
    const levels = async () => {
      const s = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo, deps());
      return Object.fromEntries(s.json.results.map((e) => [`${e.unit.id}|${e.control.id}`, e.level]));
    };
    const before = await levels();
    const r = await runCli(["update", "--to=1.5.0"], repo, deps());
    assert.equal(r.code, 0, r.err + JSON.stringify(r.json));
    assert.match(r.json.backupRef, /^\.kiritek\/backups\/engineering\//);
    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    assert.equal(doc.pack.catalog, "1.5.0");
    assert.equal(doc.defaults.controls["web.extra-check"].level, "off");
    const after = await levels();
    for (const [k, lv] of Object.entries(before)) assert.equal(after[k], lv, `${k} no cambia de nivel`);
    assert.equal(after["acme/web|web.extra-check"], "off");
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(repo, WIRING), "utf8")).surfaces).sort(), ["git", "kiro"], "superficies registradas y re-reconciliadas");
    const inv = JSON.parse(fs.readFileSync(path.join(repo, ".kiritek/inventory.json"), "utf8"));
    assert.ok(Object.values(inv.entries).filter((e) => e.owner === "engineering/guardrails").every((e) => e.packVersion && e.catalogVersion === "1.5.0"));
    const snapshot = tree(repo);
    const again = await runCli(["update", "--to=1.5.0"], repo, deps());
    assert.equal(again.code, 0);
    assert.deepEqual(tree(repo), snapshot, "segunda corrida sin cambios");
  } finally {
    clean(repo);
  }
});

test("T15C.2 downgrade: bloqueado con plan de recuperación si la config no resuelve; permitido si es compatible", async () => {
  const { repo } = makeRepo();
  try {
    setCatalog(repo, "1.5.0", (d) => (d.defaults = { controls: { "web.extra-check": { level: "off" } } }));
    await runCli(["install"], repo, deps());
    const before = tree(repo);
    const blocked = await runCli(["update", "--to=1.4.0"], repo, deps());
    assert.equal(blocked.code, 3);
    assert.equal(blocked.json.error, "CATALOG_DOWNGRADE_BLOCKED");
    assert.ok(blocked.json.recovery.length > 0);
    assert.deepEqual(tree(repo), before, "bloqueado sin mutar");
    setCatalog(repo, "1.4.0", (d) => delete d.defaults);
    const ok = await runCli(["update", "--to=1.0.0"], repo, deps());
    assert.equal(ok.code, 0, ok.err + JSON.stringify(ok.json));
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8")).pack.catalog, "1.0.0");
  } finally {
    clean(repo);
  }
});

test("T15C.1 contenido personalizado: update se detiene sin mutar (conflicto explícito)", async () => {
  const { repo } = makeRepo();
  try {
    await runCli(["install"], repo, deps());
    fs.appendFileSync(path.join(repo, ".kiritek/.gitignore"), "mio/\n");
    const before = tree(repo);
    const r = await runCli(["update"], repo, deps());
    assert.equal(r.code, 6);
    assert.equal(r.json.blocked, true);
    assert.equal(r.json.error, "MIGRATION_CONFLICT");
    assert.deepEqual(tree(repo), before);
  } finally {
    clean(repo);
  }
});

// --- T15C.5 fallos inyectados ------------------------------------------------------------

test("T15C.5 fallo inyectado en cada paso ⇒ restauración verificada byte a byte (archivos, modos, hooks, settings)", { skip: POSIX_ONLY }, async () => {
  for (const step of ["reconcile", "surfaces", "config", "inventory", "verify"]) {
    const { repo } = makeRepo();
    try {
      setCatalog(repo, "1.4.0");
      write(repo, ".git/hooks/pre-commit", "#!/bin/sh\necho usuario\n");
      fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
      write(repo, ".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./mio.sh" }] }] } }));
      await runCli(["install"], repo, deps());
      const hook = path.join(repo, ".git/hooks/pre-commit");
      const before = tree(repo, [hook]);
      const r = await runCli(["update", "--to=1.5.0", "--surfaces=git,kiro,claude,ci"], repo, deps({ faultAt: step }));
      assert.equal(r.code, 6, `${step}: ${r.err}`);
      assert.equal(r.json.rolledBack, true, step);
      assert.equal(r.json.verified, true, step);
      assert.deepEqual(tree(repo, [hook]), before, `${step}: estado restaurado`);
    } finally {
      clean(repo);
    }
  }
});

// --- T15C.2 migrate -------------------------------------------------------------------------

test("T15C.2 migrate adopta instalaciones previas (sin inventario/wiring) y es idempotente; nunca cambia niveles", { skip: POSIX_ONLY }, async () => {
  const { repo } = makeRepo();
  try {
    surfacesInstall.linkSurfaces(repo, ["git", "kiro"]);
    const cfg = fs.readFileSync(path.join(repo, CONFIG), "utf8");
    const first = await runCli(["migrate"], repo, deps());
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.changed, true);
    const wiring = JSON.parse(fs.readFileSync(path.join(repo, WIRING), "utf8"));
    assert.deepEqual(Object.keys(wiring.surfaces).sort(), ["git", "kiro"]);
    assert.equal(fs.readFileSync(path.join(repo, CONFIG), "utf8"), cfg, "la config no cambia");
    const snapshot = tree(repo);
    const second = await runCli(["migrate"], repo, deps());
    assert.equal(second.json.changed, false);
    assert.deepEqual(tree(repo), snapshot);
  } finally {
    clean(repo);
  }
});

// --- T15C.4 uninstall -------------------------------------------------------------------------

test("T15C.4 uninstall: sólo engineering; restaura el hook previo; conserva security, waivers y evidencia salvo --purge-evidence", { skip: POSIX_ONLY }, async () => {
  const { repo, base, head } = makeRepo();
  try {
    write(repo, "kiritek-security.config.json", '{"mode":"warning"}\n');
    write(repo, ".git/hooks/pre-commit", "#!/bin/sh\necho usuario\n");
    fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
    await runCli(["install", "--surfaces=git,claude"], repo, deps());
    await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo, deps());
    write(repo, ".kiritek/engineering/waivers/w.json", "{}");
    const u = await runCli(["uninstall"], repo, deps());
    assert.equal(u.code, 0, u.err);
    assert.equal(fs.readFileSync(path.join(repo, ".git/hooks/pre-commit"), "utf8"), "#!/bin/sh\necho usuario\n");
    assert.equal(fs.existsSync(path.join(repo, WIRING)), false);
    assert.ok(fs.existsSync(path.join(repo, ".kiritek/evidence/engineering/runs/pr.json")), "evidencia conservada por defecto");
    assert.deepEqual(u.json.preservedGovernance, [".kiritek/engineering/waivers"]);
    assert.equal(fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8"), '{"mode":"warning"}\n');
    const p = await runCli(["uninstall", "--purge-evidence"], repo, deps());
    assert.ok(p.json.purged.includes(".kiritek/evidence/engineering"));
    assert.equal(fs.existsSync(path.join(repo, ".kiritek/evidence/engineering")), false);
    assert.ok(fs.existsSync(path.join(repo, ".kiritek/engineering/waivers/w.json")), "waivers nunca se purgan");
    assert.ok(fs.existsSync(path.join(repo, "kiritek-security.config.json")));
  } finally {
    clean(repo);
  }
});

// --- T15C.3 portabilidad --------------------------------------------------------------------

test("T15C.3 rutas con espacios y Unicode, config CRLF: install, scan y audit funcionan", { skip: POSIX_ONLY }, async () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek eng ñandú ")));
  const { repo: src, base, head } = makeRepo();
  const repo = path.join(parent, "repo con espacios — ü");
  try {
    fs.cpSync(src, repo, { recursive: true });
    const cfg = fs.readFileSync(path.join(repo, CONFIG), "utf8").replace(/\n/g, "\r\n");
    write(repo, CONFIG, cfg);
    assert.equal((await runCli(["install", "--surfaces=git"], repo)).code, 0);
    const s = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo);
    assert.equal(s.code, 0, s.err);
    const a = await runCli(["audit"], repo);
    assert.equal(a.json.audit.surfaces["git-pre-commit"].status, "verified");
    assert.ok(a.json.audit.capabilities.some((c) => c.status === "verified"));
  } finally {
    clean(parent);
    clean(src);
  }
});

test("T15C.3 worktree: el hook se instala en el directorio de hooks común y la auditoría lo verifica", { skip: POSIX_ONLY }, async () => {
  const { repo } = makeRepo();
  const wt = path.join(fs.realpathSync(os.tmpdir()), `kiritek-eng-wt-${process.pid}-${Date.now()}`);
  try {
    git(repo, "worktree", "add", "-q", wt);
    const r = await runCli(["install", "--surfaces=git"], wt);
    assert.equal(r.code, 0, r.err);
    const hooks = gitAdapter.hooksDir(wt).dir;
    assert.ok(!hooks.startsWith(wt), `hooks comunes fuera del worktree: ${hooks}`);
    assert.match(fs.readFileSync(path.join(hooks, "pre-commit"), "utf8"), new RegExp(gitAdapter.MARKER));
    const a = await runCli(["audit"], wt);
    assert.equal(a.json.audit.surfaces["git-pre-commit"].status, "verified");
  } finally {
    clean(wt);
    clean(repo);
  }
});

test("T15C.3 matriz declarada: subconjunto Windows sin shims POSIX ni cobertura falsa; TLS nunca desactivado", async () => {
  assert.equal(MATRIX.os.win32.support, "subset");
  assert.deepEqual(platformCapabilities({ platform: "win32", nodeVersion: "22.1.0" }), { platform: "win32", support: "subset", gitHooks: false, agentShims: false, plugins: true });
  assert.equal(platformCapabilities({ platform: "linux", nodeVersion: "20.12.0" }).plugins, false);
  const { observeSurfaces, momentSurfaceStatus } = require("../../../src/engineering/guardrails/audit/surfaces.js");
  const { repo } = makeRepo();
  try {
    surfacesInstall.linkSurfaces(repo, ["git"]);
    const s = observeSurfaces(repo, { platform: "win32" });
    assert.equal(s["git-pre-commit"].observation, "not-applicable");
    assert.equal(momentSurfaceStatus("pre-commit", s).status, "unavailable", "no se atribuye cobertura en Windows");
    assert.equal(momentSurfaceStatus("agent", s).status, "unavailable");
  } finally {
    clean(repo);
  }
  const src = path.join(__dirname, "..", "..", "..", "src");
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.c?js$/.test(e.name) && /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(fs.readFileSync(abs, "utf8"))) offenders.push(abs);
    }
  };
  walk(src);
  assert.deepEqual(offenders, []);
});
