"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const core = require("../../src/install/core-security.js");
const inventory = require("../../src/install/inventory.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-core-"));
}
function exists(repo, rel) {
  return fs.existsSync(path.join(repo, rel));
}

test("installCore: instala el core sin requerir stack", () => {
  const repo = tmpRepo();
  try {
    const res = core.installCore({ repoRoot: repo });
    assert.equal(res.installed, true);
    assert.ok(exists(repo, "kiritek-security.config.json"));
    assert.ok(exists(repo, inventory.INVENTORY_FILENAME));
    const configCap = res.capabilities.find((c) => c.id === "config");
    assert.equal(configCap.status, core.CAPABILITY.ACTIVE);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: dry-run no toca el disco", () => {
  const repo = tmpRepo();
  try {
    const res = core.installCore({ repoRoot: repo, dryRun: true });
    assert.equal(res.installed, false);
    assert.equal(exists(repo, "kiritek-security.config.json"), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: repo vacío → nuevo (enforce); con contenido → existente (warning)", () => {
  const nuevo = tmpRepo();
  const existente = tmpRepo();
  try {
    assert.equal(core.installCore({ repoRoot: nuevo, dryRun: true }).mode, "enforce");
    fs.writeFileSync(path.join(existente, "package.json"), "{}");
    assert.equal(core.installCore({ repoRoot: existente, dryRun: true }).mode, "warning");
  } finally {
    fs.rmSync(nuevo, { recursive: true, force: true });
    fs.rmSync(existente, { recursive: true, force: true });
  }
});

test("installCore: git-hooks unavailable si no hay repo Git", () => {
  const repo = tmpRepo();
  try {
    const res = core.installCore({ repoRoot: repo });
    const hooks = res.capabilities.find((c) => c.id === "git-hooks");
    assert.equal(hooks.status, core.CAPABILITY.UNAVAILABLE);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: git-hooks ACTIVE cuando se instalan en un repo Git real", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    const res = core.installCore({ repoRoot: repo });
    const hooks = res.capabilities.find((c) => c.id === "git-hooks");
    // Ahora los hooks se instalan de verdad: la capa queda ACTIVE.
    assert.equal(hooks.status, core.CAPABILITY.ACTIVE);
    assert.equal(res.hooks.applied, true);
    for (const name of ["pre-commit", "pre-push", "commit-msg"]) {
      const hp = path.join(repo, ".git", "hooks", name);
      assert.ok(fs.existsSync(hp), name + " debe existir");
      // Ejecutable y administrado por Kiritek.
      fs.accessSync(hp, fs.constants.X_OK);
      assert.ok(fs.readFileSync(hp, "utf8").includes("Kiritek managed"));
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: git-hooks PENDING cuando hay un gestor de hooks de terceros", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    // Firma de un gestor de terceros (Husky): no se deben tocar sus hooks.
    fs.mkdirSync(path.join(repo, ".husky", "_"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".husky", "_", "husky.sh"), "# husky\n");
    const res = core.installCore({ repoRoot: repo });
    const hooks = res.capabilities.find((c) => c.id === "git-hooks");
    assert.equal(hooks.status, core.CAPABILITY.PENDING_CONFIGURATION);
    assert.equal(res.hooks.strategy, "manual");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: secret-scanning no se declara active (pin pendiente)", () => {
  const repo = tmpRepo();
  try {
    const res = core.installCore({ repoRoot: repo });
    const scan = res.capabilities.find((c) => c.id === "secret-scanning");
    assert.notEqual(scan.status, core.CAPABILITY.ACTIVE);
    assert.equal(scan.status, core.CAPABILITY.PENDING_CONFIGURATION);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: --security=off no instala y marca no conforme", () => {
  const repo = tmpRepo();
  try {
    const res = core.installCore({ repoRoot: repo, security: "off" });
    assert.equal(res.installed, false);
    assert.equal(res.compliant, false);
    assert.ok(res.omitted.length > 0);
    assert.equal(exists(repo, "kiritek-security.config.json"), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: repetición es idempotente (segunda corrida noop)", () => {
  const repo = tmpRepo();
  try {
    core.installCore({ repoRoot: repo });
    const res2 = core.installCore({ repoRoot: repo });
    assert.equal(res2.installed, true);
    // El config owned no cambió → noop; ignores managed → merge idempotente.
    assert.equal(res2.reconcile.summary.conflict, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installCore: sólo instala artefactos del core (no toca otros archivos)", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "mi-archivo.txt"), "intacto");
    core.installCore({ repoRoot: repo });
    assert.equal(fs.readFileSync(path.join(repo, "mi-archivo.txt"), "utf8"), "intacto");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
