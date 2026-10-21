"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const inv = require("../../src/install/inventory.js");
const { validateAgainst } = require("../../src/domain/schema-validator.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-inv-"));
}

function writeFile(repo, rel, content) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function writeInventory(repo, entries) {
  const file = path.join(repo, inv.INVENTORY_FILENAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries }, null, 2));
}

test("desiredArtifact: valida estrategia y campos", () => {
  assert.throws(() => inv.desiredArtifact({ path: "a", strategy: "bogus", distHash: "h" }), /strategy/);
  const a = inv.desiredArtifact({ path: "a.txt", strategy: "owned", distHash: "h" });
  assert.equal(a.owner, "core");
});

test("safeRelPath: rechaza rutas fuera del repo", () => {
  assert.throws(() => inv.safeRelPath("/repo", "../x"), /fuera del repositorio/);
  assert.equal(inv.safeRelPath("/repo", "a/b.txt"), "a/b.txt");
});

test("discover: artefacto ausente → create", () => {
  const repo = tmpRepo();
  try {
    const desired = [inv.desiredArtifact({ path: "core/x.txt", strategy: "owned", distHash: "H1" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].operation, inv.OPERATION.CREATE);
    assert.equal(res.summary.create, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: owned igual a distribución → noop", () => {
  const repo = tmpRepo();
  try {
    const content = "contenido";
    const h = inv.sha256(Buffer.from(content));
    writeFile(repo, "core/x.txt", content);
    const desired = [inv.desiredArtifact({ path: "core/x.txt", strategy: "owned", distHash: h })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].operation, inv.OPERATION.NOOP);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: owned personalizado por el usuario → conflict", () => {
  const repo = tmpRepo();
  try {
    const installed = "original";
    const installedHash = inv.sha256(Buffer.from(installed));
    writeFile(repo, "core/x.txt", "MODIFICADO POR USUARIO");
    writeInventory(repo, { "core/x.txt": { owner: "core", strategy: "owned", installedHash } });
    const desired = [inv.desiredArtifact({ path: "core/x.txt", strategy: "owned", distHash: "NUEVA" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].customized, true);
    assert.equal(res.items[0].operation, inv.OPERATION.CONFLICT);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: owned no personalizado con nueva distribución → replace", () => {
  const repo = tmpRepo();
  try {
    const installed = "v1";
    const installedHash = inv.sha256(Buffer.from(installed));
    writeFile(repo, "core/x.txt", installed);
    writeInventory(repo, { "core/x.txt": { owner: "core", strategy: "owned", installedHash } });
    const desired = [inv.desiredArtifact({ path: "core/x.txt", strategy: "owned", distHash: "v2hash" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].customized, false);
    assert.equal(res.items[0].operation, inv.OPERATION.REPLACE);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: generated existente → noop (no re-genera)", () => {
  const repo = tmpRepo();
  try {
    writeFile(repo, "CLAUDE.md", "doc del usuario");
    const desired = [inv.desiredArtifact({ path: "CLAUDE.md", strategy: "generated", distHash: "H" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].operation, inv.OPERATION.NOOP);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: managed-block existente → merge", () => {
  const repo = tmpRepo();
  try {
    writeFile(repo, ".gitignore", "node_modules\n");
    const desired = [inv.desiredArtifact({ path: ".gitignore", strategy: "managed-block", distHash: "H" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].operation, inv.OPERATION.MERGE);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: symlink que escapa del repo → conflict", () => {
  const repo = tmpRepo();
  const outside = tmpRepo();
  try {
    const outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "x");
    const linkPath = path.join(repo, "core");
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(outsideFile, linkPath);
    const desired = [inv.desiredArtifact({ path: "core", strategy: "owned", distHash: "H" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].symlinkEscape, true);
    assert.equal(res.items[0].operation, inv.OPERATION.CONFLICT);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("discover: detecta instalación legacy sin inventario", () => {
  const repo = tmpRepo();
  try {
    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    const res = inv.discover(repo, []);
    assert.equal(res.legacy, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: archivo vacío se marca empty", () => {
  const repo = tmpRepo();
  try {
    writeFile(repo, "core/x.txt", "");
    const desired = [inv.desiredArtifact({ path: "core/x.txt", strategy: "owned", distHash: "H" })];
    const res = inv.discover(repo, desired);
    assert.equal(res.items[0].empty, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("discover: determinista (dos corridas idénticas)", () => {
  const repo = tmpRepo();
  try {
    writeFile(repo, "core/x.txt", "v1");
    const desired = [inv.desiredArtifact({ path: "core/x.txt", strategy: "owned", distHash: "v2" })];
    const r1 = inv.discover(repo, desired);
    const r2 = inv.discover(repo, desired);
    assert.deepEqual(r1, r2);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("schema: inventario de ejemplo cumple el schema", () => {
  const sample = {
    schemaVersion: 1,
    entries: {
      "core/x.txt": { owner: "core", strategy: "owned", installedHash: "abc", version: "1.0.0" },
    },
  };
  assert.equal(validateAgainst("inventory", sample).valid, true);
});
