"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createTransaction } = require("../../src/install/transaction.js");
const { reconcile } = require("../../src/install/reconcile.js");
const { migrateLegacy, writeMigratedInventory } = require("../../src/install/migrate.js");
const { uninstall } = require("../../src/install/uninstall.js");
const inventory = require("../../src/install/inventory.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-tx-"));
}
function read(repo, rel) {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}
function exists(repo, rel) {
  return fs.existsSync(path.join(repo, rel));
}
function art(p, content, strategy = "owned") {
  return inventory.desiredArtifact({ path: p, strategy, distHash: inventory.sha256(Buffer.from(content)), ...{} });
}
function withContent(p, content, strategy = "owned") {
  return { ...art(p, content, strategy), content };
}

// --- transaction.js ---

test("transaction: commit aplica y rollback restaura estado previo", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "a.txt"), "ORIGINAL");
    const tx = createTransaction(repo);
    tx.writeFile("a.txt", "NUEVO");
    tx.writeFile("b.txt", "CREADO");
    assert.equal(read(repo, "a.txt"), "NUEVO");
    tx.rollback();
    assert.equal(read(repo, "a.txt"), "ORIGINAL"); // restaurado
    assert.equal(exists(repo, "b.txt"), false); // el que no existía se elimina
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("transaction: rechaza rutas fuera del repo", () => {
  const repo = tmpRepo();
  try {
    const tx = createTransaction(repo);
    assert.throws(() => tx.writeFile("../escape.txt", "x"), /fuera del repositorio/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- reconcile.js ---

test("reconcile: dry-run no toca el disco", () => {
  const repo = tmpRepo();
  try {
    const res = reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "hola")], dryRun: true });
    assert.equal(res.applied, false);
    assert.equal(exists(repo, "core/x.txt"), false);
    assert.equal(res.summary.create, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("reconcile: crea artefacto y registra inventario sólo al confirmar", () => {
  const repo = tmpRepo();
  try {
    const res = reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "hola")] });
    assert.equal(res.applied, true);
    assert.equal(read(repo, "core/x.txt"), "hola");
    const inv = inventory.readInventory(repo);
    assert.ok(inv.entries["core/x.txt"]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("reconcile: idempotente — segunda corrida es noop y no reescribe", () => {
  const repo = tmpRepo();
  try {
    reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "hola")] });
    const res2 = reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "hola")] });
    assert.equal(res2.summary.noop, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("reconcile: fault injection dispara rollback completo", () => {
  const repo = tmpRepo();
  try {
    fs.mkdirSync(path.join(repo, "core"), { recursive: true });
    fs.writeFileSync(path.join(repo, "core/existing.txt"), "PREVIO");
    const res = reconcile({
      repoRoot: repo,
      desired: [
        withContent("core/existing.txt", "NUEVO"),
        withContent("core/other.txt", "OTRO"),
      ],
      faultInjector: () => {
        throw new Error("fallo simulado");
      },
    });
    assert.equal(res.applied, false);
    assert.equal(res.rolledBack, true);
    // Estado restaurado: el existente vuelve a PREVIO, el nuevo no queda.
    assert.equal(read(repo, "core/existing.txt"), "PREVIO");
    assert.equal(exists(repo, "core/other.txt"), false);
    // El inventario no se persistió.
    assert.equal(exists(repo, inventory.INVENTORY_FILENAME), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("reconcile: self-check que falla provoca rollback", () => {
  const repo = tmpRepo();
  try {
    const res = reconcile({
      repoRoot: repo,
      desired: [withContent("core/x.txt", "hola")],
      selfCheck: () => {
        throw new Error("self-check falló");
      },
    });
    assert.equal(res.rolledBack, true);
    assert.equal(exists(repo, "core/x.txt"), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("reconcile: artefacto personalizado (owned) → conflicto deja .kiritek-new sin sobrescribir", () => {
  const repo = tmpRepo();
  try {
    // Primera instalación.
    reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "v1")] });
    // Usuario edita el archivo owned.
    fs.writeFileSync(path.join(repo, "core/x.txt"), "EDITADO POR USUARIO");
    // Nueva versión intenta instalarse.
    const res = reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "v2")] });
    assert.ok(res.conflicts.includes("core/x.txt"));
    assert.equal(read(repo, "core/x.txt"), "EDITADO POR USUARIO"); // no se tocó
    assert.ok(exists(repo, "core/x.txt.kiritek-new"));
    assert.equal(read(repo, "core/x.txt.kiritek-new"), "v2");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- migrate.js ---

test("migrate: adopta artefactos legacy y es reentrante", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "kiritek-audit.config.json"), "{}");
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "doc");
    const r1 = migrateLegacy(repo, { now: () => "2026-10-01T00:00:00.000Z" });
    assert.deepEqual(r1.migrated.sort(), ["CLAUDE.md", "kiritek-audit.config.json"]);
    writeMigratedInventory(repo, r1.inventory);
    // Segunda corrida: nada nuevo, sin duplicar.
    const r2 = migrateLegacy(repo, { now: () => "2026-10-01T00:00:00.000Z" });
    assert.equal(r2.migrated.length, 0);
    assert.ok(r2.alreadyTracked.includes("CLAUDE.md"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- uninstall.js ---

test("uninstall: retira owned no personalizado y preserva drift", () => {
  const repo = tmpRepo();
  try {
    reconcile({
      repoRoot: repo,
      desired: [withContent("core/clean.txt", "limpio"), withContent("core/dirty.txt", "v1")],
    });
    // El usuario personaliza uno.
    fs.writeFileSync(path.join(repo, "core/dirty.txt"), "EDITADO");
    const res = uninstall({ repoRoot: repo });
    assert.equal(res.applied, true);
    assert.ok(res.removed.includes("core/clean.txt"));
    assert.ok(res.preservedDrift.includes("core/dirty.txt"));
    assert.equal(exists(repo, "core/clean.txt"), false);
    assert.equal(read(repo, "core/dirty.txt"), "EDITADO"); // conservado
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("uninstall: strip del bloque managed preserva contenido del usuario", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
    reconcile({ repoRoot: repo, desired: [withContent(".gitignore", ".kiritek/security/", "managed-block")] });
    assert.ok(read(repo, ".gitignore").includes(".kiritek/security/"));
    const res = uninstall({ repoRoot: repo });
    assert.ok(res.blocksStripped.includes(".gitignore"));
    const after = read(repo, ".gitignore");
    assert.ok(after.includes("node_modules"));
    assert.ok(!after.includes(".kiritek/security/"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("uninstall: dry-run no toca nada", () => {
  const repo = tmpRepo();
  try {
    reconcile({ repoRoot: repo, desired: [withContent("core/x.txt", "hola")] });
    const res = uninstall({ repoRoot: repo, dryRun: true });
    assert.equal(res.applied, false);
    assert.ok(res.wouldRemove.includes("core/x.txt"));
    assert.equal(exists(repo, "core/x.txt"), true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
