"use strict";

// T09.6: CLI engineering e instalación transaccional.
// Cubre: instalación limpia/existente/parcial, doble install (idempotente),
// fallo inyectado (rollback), rutas con espacios y coexistencia con security.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const cli = require("../../../src/engineering/guardrails/cli.js");
const { install } = require("../../../src/engineering/guardrails/install/reconcile.js");
const { uninstall } = require("../../../src/engineering/guardrails/install/uninstall.js");
const inventory = require("../../../src/install/inventory.js");
const { installCore } = require("../../../src/install/core-security.js");

const CONFIG = "kiritek-engineering.config.json";
const SECURITY_CONFIG = "kiritek-security.config.json";

function tmpRepo(prefix = "kiritek-eng-cli-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function gitRepo(prefix) {
  const dir = tmpRepo(prefix);
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "a@b.c"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "x"]);
  return dir;
}
function exists(repo, rel) {
  return fs.existsSync(path.join(repo, rel));
}
function clean(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Ejecuta un comando del CLI capturando stdout/stderr y el exit code. */
async function runCli(argv, cwd, env = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => (out += s) };
  const stderr = { write: (s) => (err += s) };
  const code = await cli.runAsync(argv, { cwd, env, stdout, stderr });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) {
    json = null;
  }
  return { code, out, err, json };
}

/* -------------------------- Instalación limpia -------------------------- */

test("T09.4 instalación limpia: crea artefactos engineering y registra ownership", async () => {
  const repo = tmpRepo();
  try {
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.equal(r.json.installed, true);
    assert.ok(exists(repo, CONFIG));
    assert.ok(exists(repo, ".kiritek/.gitignore"));
    assert.ok(exists(repo, ".kiritek/engineering/README.md"));
    assert.ok(exists(repo, inventory.INVENTORY_FILENAME));
    const inv = inventory.readInventory(repo);
    for (const [, e] of Object.entries(inv.entries)) {
      assert.equal(e.owner, "engineering/guardrails");
    }
  } finally {
    clean(repo);
  }
});

test("T09.4 NO toca la config de security ni crea artefactos core", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    assert.equal(exists(repo, SECURITY_CONFIG), false);
    // Nada bajo .github ni gitleaks (artefactos de core/security).
    assert.equal(exists(repo, ".github/workflows/kiritek-security.yml"), false);
    assert.equal(exists(repo, ".kiritek/gitleaks.toml"), false);
  } finally {
    clean(repo);
  }
});

test("T09.1 dry-run no muta el disco", async () => {
  const repo = tmpRepo();
  try {
    const r = await runCli(["install", "--dry-run"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.equal(r.json.dryRun, true);
    assert.equal(exists(repo, CONFIG), false);
    assert.equal(exists(repo, inventory.INVENTORY_FILENAME), false);
  } finally {
    clean(repo);
  }
});

/* --------------------- Instalación existente / parcial ------------------ */

test("T09.5 instalación existente (proyecto con contenido) coexiste sin romper", async () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "package.json"), "{}\n");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log(1);\n");
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.ok(exists(repo, CONFIG));
    // Los archivos del usuario se conservan intactos.
    assert.equal(fs.readFileSync(path.join(repo, "src", "app.js"), "utf8"), "console.log(1);\n");
  } finally {
    clean(repo);
  }
});

test("T09.5 instalación parcial: completa lo que falta sin duplicar lo existente", async () => {
  const repo = tmpRepo();
  try {
    // Primera instalación completa.
    await runCli(["install"], repo);
    // Simular estado parcial: borrar un artefacto generado del disco.
    fs.rmSync(path.join(repo, ".kiritek/engineering/README.md"), { force: true });
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.ok(exists(repo, ".kiritek/engineering/README.md"), "re-crea el artefacto faltante");
    // El config owned no se duplica (noop).
    assert.equal(r.json.summary.noop >= 1, true);
  } finally {
    clean(repo);
  }
});

/* ----------------------- Doble install (idempotente) -------------------- */

test("T09.5 doble install es idempotente (segunda corrida: todo noop)", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    const before = fs.readFileSync(path.join(repo, CONFIG));
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.equal(r.json.summary.create, 0);
    assert.equal(r.json.summary.replace, 0);
    assert.equal(r.json.summary.conflict, 0);
    assert.equal(r.json.summary.noop, 3);
    assert.deepEqual(fs.readFileSync(path.join(repo, CONFIG)), before, "config byte-idéntica tras reinstalar");
  } finally {
    clean(repo);
  }
});

/* --------------------------- Fallo inyectado ---------------------------- */

test("T09.5 fallo inyectado durante la aplicación revierte todo (rollback)", () => {
  const repo = tmpRepo();
  try {
    const res = install({ repoRoot: repo, faultInjector: () => { throw new Error("boom"); } });
    assert.equal(res.applied, false);
    assert.equal(res.rolledBack, true);
    // Nada quedó persistido.
    assert.equal(exists(repo, CONFIG), false);
    assert.equal(exists(repo, inventory.INVENTORY_FILENAME), false);
  } finally {
    clean(repo);
  }
});

test("T09.5 fallo inyectado sobre una instalación previa restaura el estado anterior", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    const configBefore = fs.readFileSync(path.join(repo, CONFIG));
    const invBefore = fs.readFileSync(path.join(repo, inventory.INVENTORY_FILENAME));
    // Reinstalar con fallo: como todo era noop no habría escrituras, forzamos
    // un cambio borrando un artefacto para que haya una operación que revertir.
    fs.rmSync(path.join(repo, ".kiritek/engineering/README.md"), { force: true });
    const res = install({ repoRoot: repo, faultInjector: () => { throw new Error("boom"); } });
    assert.equal(res.applied, false);
    assert.equal(res.rolledBack, true);
    // La config y el inventario previos siguen intactos.
    assert.deepEqual(fs.readFileSync(path.join(repo, CONFIG)), configBefore);
    assert.deepEqual(fs.readFileSync(path.join(repo, inventory.INVENTORY_FILENAME)), invBefore);
  } finally {
    clean(repo);
  }
});

/* -------------------------- Rutas con espacios -------------------------- */

test("T09.6 funciona con una raíz de repo que contiene espacios", async () => {
  const base = tmpRepo();
  const repo = path.join(base, "my project with spaces");
  fs.mkdirSync(repo, { recursive: true });
  try {
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.ok(exists(repo, CONFIG));
    const v = await runCli(["validate"], repo);
    assert.equal(v.code, cli.EXIT.OK);
    assert.equal(v.json.ok, true);
  } finally {
    clean(base);
  }
});

/* -------------------- Conflicto: propuesta .kiritek-new ----------------- */

test("T09.5 conflicto en artefacto owned personalizado deja .kiritek-new sin pisar", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    // El usuario personaliza la config owned.
    fs.writeFileSync(path.join(repo, CONFIG), '{"schemaVersion":1,"pack":{"id":"engineering/guardrails","catalog":"1.0.0"},"workspace":{"units":[]},"custom":true}\n');
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.MIGRATION_CONFLICT);
    assert.ok(r.json.conflicts.includes(CONFIG));
    // El archivo del usuario NO se sobrescribe; se deja una propuesta.
    assert.ok(fs.readFileSync(path.join(repo, CONFIG), "utf8").includes("\"custom\":true"));
    assert.ok(exists(repo, `${CONFIG}.kiritek-new`));
  } finally {
    clean(repo);
  }
});

/* -------------------------- Coexistencia security ----------------------- */

test("T09.4 coexistencia: engineering convive con core/security sin interferir", async () => {
  const repo = tmpRepo();
  try {
    const sec = installCore({ repoRoot: repo });
    assert.equal(sec.installed, true);
    await runCli(["install"], repo);
    const inv = inventory.readInventory(repo);
    const owners = new Set(Object.values(inv.entries).map((e) => e.owner));
    assert.ok(owners.has("core"));
    assert.ok(owners.has("engineering/guardrails"));
    // Ambas configs coexisten.
    assert.ok(exists(repo, SECURITY_CONFIG));
    assert.ok(exists(repo, CONFIG));
  } finally {
    clean(repo);
  }
});

test("T09.5 uninstall selectivo: sólo artefactos engineering; preserva security", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const secConfigBefore = fs.readFileSync(path.join(repo, SECURITY_CONFIG));
    await runCli(["install"], repo);
    const r = await runCli(["uninstall"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.ok(r.json.removed.includes(CONFIG));
    assert.ok(r.json.preservedOtherOwners.includes(SECURITY_CONFIG));
    // La config y el workflow de security siguen presentes e intactos.
    assert.ok(exists(repo, SECURITY_CONFIG));
    assert.deepEqual(fs.readFileSync(path.join(repo, SECURITY_CONFIG)), secConfigBefore);
    assert.equal(exists(repo, CONFIG), false);
    // El inventario conserva sólo entradas core.
    const inv = inventory.readInventory(repo);
    assert.deepEqual([...new Set(Object.values(inv.entries).map((e) => e.owner))], ["core"]);
  } finally {
    clean(repo);
  }
});

test("T09.5 uninstall preserva artefactos engineering personalizados (drift)", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    fs.writeFileSync(path.join(repo, CONFIG), '{"schemaVersion":1,"pack":{"id":"engineering/guardrails","catalog":"1.0.0"},"workspace":{"units":[]},"mine":true}\n');
    const r = await runCli(["uninstall"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.ok(r.json.preservedDrift.includes(CONFIG));
    assert.ok(exists(repo, CONFIG), "la config personalizada se conserva");
  } finally {
    clean(repo);
  }
});

/* --------------------------- Flags y exit codes ------------------------- */

test("T09.2 rechaza flags desconocidos con exit de uso", async () => {
  const repo = tmpRepo();
  try {
    const r = await runCli(["install", "--bogus"], repo);
    assert.equal(r.code, cli.EXIT.USAGE);
    assert.equal(r.json.ok, false);
  } finally {
    clean(repo);
  }
});

test("T09.2 rechaza flags que parecen credenciales", async () => {
  const repo = tmpRepo();
  try {
    for (const f of ["--token=x", "--secret=x", "--password=x", "--api-key=x"]) {
      const r = await runCli(["scan", "--moment=pr", f], repo);
      assert.equal(r.code, cli.EXIT.USAGE, `${f} debe rechazarse`);
    }
  } finally {
    clean(repo);
  }
});

test("T09.3 scan sin moment válido es error de uso (2)", async () => {
  const repo = gitRepo();
  try {
    await runCli(["install"], repo);
    const r = await runCli(["scan"], repo);
    assert.equal(r.code, cli.EXIT.USAGE);
    assert.equal(r.json.error, "INVALID_MOMENT");
  } finally {
    clean(repo);
  }
});

test("T09.3/T14 scan con controles builtin: sin evidencia ⇒ warn honesto (exit 0), nunca allow falso", async () => {
  const repo = gitRepo();
  try {
    const cfg = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog: "1.0.0" },
      workspace: { units: [{ id: "acme/search-web", root: "apps/searchweb", kind: "application", profiles: [{ id: "search", version: "1.0.0" }], owns: ["apps/searchweb/**"] }] },
      defaults: { controls: { "search.input-rate": { level: "warn" } } },
    };
    fs.mkdirSync(path.join(repo, "apps/searchweb"), { recursive: true });
    fs.writeFileSync(path.join(repo, "apps/searchweb/f.txt"), "hi");
    fs.writeFileSync(path.join(repo, CONFIG), JSON.stringify(cfg, null, 2));
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"]);
    const r = await runCli(["scan", "--moment=release", "--unit=acme/search-web"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.equal(r.json.outcome.decision, "warn");
    assert.equal(r.json.outcome.policyDeny, false);
    // Con perfil declarado y sin contrato conductual ⇒ evaluado con warn; sin
    // el perfil requerido ⇒ not_applicable (R5.3). Ninguno es un allow falso.
    const byControl = Object.fromEntries(r.json.results.map((x) => [x.control.id, x.state]));
    assert.equal(byControl["search.input-rate"], "evaluated");
    assert.equal(r.json.results.find((x) => x.control.id === "search.input-rate").result.decision, "warn");
    assert.ok(r.json.annotations.some((a) => a.controlId === "search.input-rate" && a.level === "warning"));
    assert.equal(byControl["app.minimum-supported-version"], "not_applicable");
    assert.equal(byControl["web.module-announcement"], "not_applicable");
    assert.ok(r.json.results.every((x) => !x.result || x.result.decision !== "allow"));
  } finally {
    clean(repo);
  }
});

test("T09.3 config irresoluble (sin config) produce error de configuración (3)", async () => {
  const repo = tmpRepo();
  try {
    const r = await runCli(["validate"], repo);
    assert.equal(r.code, cli.EXIT.CONFIG);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, "CONFIG_NOT_FOUND");
  } finally {
    clean(repo);
  }
});

/* ------------------------------- catalog diff --------------------------- */

test("T09.1 catalog diff con versión inexistente es error de configuración", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    const r = await runCli(["catalog", "diff", "--to=9.9.9"], repo);
    assert.equal(r.code, cli.EXIT.CONFIG);
    assert.equal(r.json.ok, false);
  } finally {
    clean(repo);
  }
});

test("T09.1 catalog diff a la misma versión es estable y sin violaciones", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    const r = await runCli(["catalog", "diff", "--to=1.0.0"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.equal(r.json.diff.requiredBump, "none");
    assert.deepEqual(r.json.diff.semverViolations, []);
  } finally {
    clean(repo);
  }
});

/* --------------------------- promote (gated) ---------------------------- */

test("T09.1 promote exige --unit/--control/--to=enforce y rechaza sin readiness", async () => {
  const repo = tmpRepo();
  try {
    await runCli(["install"], repo);
    const missing = await runCli(["promote", "--to=enforce"], repo);
    assert.equal(missing.code, cli.EXIT.USAGE);
    const gated = await runCli(["promote", "--unit=acme/x", "--control=search.input-rate", "--to=enforce"], repo);
    assert.equal(gated.code, cli.EXIT.CONFIG);
    assert.equal(gated.json.promoted, false);
    assert.ok(gated.json.blockers.length > 0);
  } finally {
    clean(repo);
  }
});

test("T09.5 install no pisa una config engineering preexistente del usuario (no registrada)", async () => {
  const repo = tmpRepo();
  try {
    const mine = '{"schemaVersion":1,"pack":{"id":"engineering/guardrails","catalog":"1.0.0"},"workspace":{"units":[{"id":"acme/a","root":"a","kind":"application","profiles":[],"owns":["a/**"]}]}}\n';
    fs.writeFileSync(path.join(repo, CONFIG), mine);
    const r = await runCli(["install"], repo);
    assert.equal(r.code, cli.EXIT.OK);
    assert.equal(fs.readFileSync(path.join(repo, CONFIG), "utf8"), mine);
  } finally {
    clean(repo);
  }
});
