"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const hooks = require("../../src/git/hooks.js");

function git(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-hooks-"));
  git(repo, ["init", "-q"]);
  return repo;
}

test("planHookInstall: repo limpio → install para los 3 hooks", () => {
  const repo = initRepo();
  try {
    const plan = hooks.planHookInstall(repo);
    assert.equal(plan.strategy, "install");
    assert.equal(plan.hooks.length, 3);
    assert.ok(plan.hooks.every((h) => h.action === "install"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("planHookInstall: hook nativo previo → chain (preservar)", () => {
  const repo = initRepo();
  try {
    const hookFile = path.join(repo, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hookFile, "#!/bin/sh\necho hook del usuario\n");
    const plan = hooks.planHookInstall(repo);
    const pc = plan.hooks.find((h) => h.name === "pre-commit");
    assert.equal(pc.action, "chain");
    assert.equal(pc.hadExisting, true);
    assert.equal(pc.wasManaged, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("planHookInstall: hook ya gestionado por Kiritek → reinstall (idempotente)", () => {
  const repo = initRepo();
  try {
    const hookFile = path.join(repo, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hookFile, "#!/bin/sh\n# Kiritek managed pre-commit hook\n");
    const plan = hooks.planHookInstall(repo);
    const pc = plan.hooks.find((h) => h.name === "pre-commit");
    assert.equal(pc.action, "reinstall");
    assert.equal(pc.wasManaged, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("planHookInstall: gestor de terceros (husky) → estrategia manual, sin tocar", () => {
  const repo = initRepo();
  try {
    fs.mkdirSync(path.join(repo, ".husky"), { recursive: true });
    const plan = hooks.planHookInstall(repo);
    assert.equal(plan.strategy, "manual");
    assert.equal(plan.manager, "husky");
    assert.equal(plan.hooks.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("planHookInstall: lefthook detectado", () => {
  const repo = initRepo();
  try {
    fs.writeFileSync(path.join(repo, "lefthook.yml"), "pre-commit:\n");
    const plan = hooks.planHookInstall(repo);
    assert.equal(plan.manager, "lefthook");
    assert.equal(plan.strategy, "manual");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("gitHooksDir: respeta core.hooksPath personalizado", () => {
  const repo = initRepo();
  try {
    git(repo, ["config", "core.hooksPath", ".myhooks"]);
    const dir = hooks.gitHooksDir(repo);
    assert.ok(dir.endsWith(".myhooks"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("templates de hooks existen, son dispatcher y traen guard anti-recursión", () => {
  const base = path.join(__dirname, "..", "..", "templates", "core", "security", "hooks");
  for (const name of hooks.HOOK_NAMES) {
    const content = fs.readFileSync(path.join(base, name), "utf8");
    assert.ok(hooks.isManagedByKiritek(content), `${name} debe llevar el marcador gestionado`);
    assert.ok(content.includes("KIRITEK_HOOK_RUNNING"), `${name} debe tener guard anti-recursión`);
    assert.ok(content.includes(".previous"), `${name} debe encadenar el hook previo`);
  }
});

test("previousPath: ruta de preservación dentro de .kiritek/hooks", () => {
  const p = hooks.previousPath("/repo", "pre-commit");
  assert.ok(p.endsWith(path.join(".kiritek", "hooks", "pre-commit.previous")));
});
