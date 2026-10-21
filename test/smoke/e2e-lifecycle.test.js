"use strict";

/**
 * Smoke E2E de los comandos de ciclo de vida sobre el BINARIO REAL.
 *
 * Ejecuta "node bin/kiritek-init.js <cmd>" en un repo git temporal y verifica,
 * de punta a punta, que los comandos que antes eran stubs ahora están
 * CONECTADOS: scan corre el motor real, security install orquesta hooks +
 * tooling + adapters + CI, uninstall revierte selectivamente y migrate adopta
 * instalaciones legacy. Sin red ni secretos reales.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "..", "bin", "kiritek-init.js");

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-e2e-life-"));
  spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
  return repo;
}

function run(args, cwd, input) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: "utf8" });
  let json = null;
  // El stdout puede traer varias líneas (humano + JSON); se intenta parsear
  // la última línea no vacía como JSON.
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && json === null; i -= 1) {
    try { json = JSON.parse(lines.slice(i).join("\n")); } catch (_) { /* sigue */ }
  }
  if (json === null) { try { json = JSON.parse(r.stdout); } catch (_) {} }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

test("E2E security install: orquesta hooks + tooling + adapters + CI", () => {
  const repo = tmpRepo();
  try {
    const r = run(["security", "install"], repo, "");
    assert.equal(r.code, 0);
    // Hooks reales instalados y ejecutables.
    for (const name of ["pre-commit", "pre-push", "commit-msg"]) {
      const hp = path.join(repo, ".git", "hooks", name);
      assert.ok(fs.existsSync(hp), name + " debe existir");
      fs.accessSync(hp, fs.constants.X_OK);
    }
    // Tooling + adapters + CI en disco.
    assert.ok(fs.existsSync(path.join(repo, ".kiritek", "tools", "manifest.json")));
    assert.ok(fs.existsSync(path.join(repo, ".kiritek", "adapters", "claude", "pretooluse.sh")));
    assert.ok(fs.existsSync(path.join(repo, ".github", "workflows", "kiritek-security.yml")));
    // Capacidad git-hooks ACTIVE (ya no pending).
    const gitHooks = r.json.capabilities.find((c) => c.id === "git-hooks");
    assert.equal(gitHooks.status, "active");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E security install: idempotente (segunda corrida no rompe)", () => {
  const repo = tmpRepo();
  try {
    const a = run(["security", "install"], repo, "");
    const b = run(["security", "install"], repo, "");
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    const gh = b.json.capabilities.find((c) => c.id === "git-hooks");
    assert.equal(gh.status, "active");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E uninstall --security: revierte y preserva contenido del usuario", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, ".gitignore"), "# user\nnode_modules/\n");
    run(["security", "install"], repo, "");
    assert.ok(fs.existsSync(path.join(repo, "kiritek-security.config.json")));
    const u = run(["uninstall", "--security"], repo, "");
    assert.equal(u.code, 0);
    assert.equal(u.json.applied, true);
    // La config propiedad de Kiritek se elimina.
    assert.equal(fs.existsSync(path.join(repo, "kiritek-security.config.json")), false);
    // El contenido del usuario en .gitignore se preserva (sólo se quita el bloque).
    const gi = fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
    assert.ok(gi.includes("node_modules/"));
    assert.equal(gi.includes("kiritek-security (managed)"), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E uninstall --security --dry-run: planifica sin mutar", () => {
  const repo = tmpRepo();
  try {
    run(["security", "install"], repo, "");
    const u = run(["uninstall", "--security", "--dry-run"], repo, "");
    assert.equal(u.code, 0);
    assert.equal(u.json.dryRun, true);
    assert.ok(Array.isArray(u.json.wouldRemove));
    // No mutó: la config sigue presente.
    assert.ok(fs.existsSync(path.join(repo, "kiritek-security.config.json")));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E migrate: adopta una instalación legacy y es reentrante", () => {
  const repo = tmpRepo();
  try {
    // Simula legacy 0.1.0: config de auditoría + CLAUDE.md, sin inventario.
    fs.writeFileSync(path.join(repo, "kiritek-audit.config.json"), JSON.stringify({ schedule: "weekly" }));
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# Claude\n");
    const m1 = run(["migrate"], repo, "");
    assert.equal(m1.code, 0);
    assert.equal(m1.json.applied, true);
    assert.ok(fs.existsSync(path.join(repo, ".kiritek", "inventory.json")));
    // Preservación: la config legacy no se borra.
    assert.ok(fs.existsSync(path.join(repo, "kiritek-audit.config.json")));
    // Reentrante: segunda corrida no vuelve a adoptar lo mismo.
    const m2 = run(["migrate"], repo, "");
    assert.equal(m2.code, 0);
    assert.deepEqual(m2.json.adoption.migrated, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E scan staged: bloquea un archivo sensible en enforce (deny, exit 1)", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "kiritek-security.config.json"), JSON.stringify({ version: 1, mode: "enforce" }));
    fs.writeFileSync(path.join(repo, ".env"), "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n");
    spawnSync("git", ["-C", repo, "add", ".env"], { encoding: "utf8" });
    const r = run(["scan", "--scope=staged"], repo, "");
    assert.equal(r.code, 1);
    assert.equal(r.json.decision, "deny");
    // El valor sensible nunca aparece en la salida.
    assert.equal((r.stdout + r.stderr).includes("wJalrXUtnFEMI"), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
