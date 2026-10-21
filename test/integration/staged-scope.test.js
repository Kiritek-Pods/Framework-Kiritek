"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { computeStagedScope } = require("../../src/git/staged-scope.js");
const { scanStaged, clearCache } = require("../../src/scanners/staged-scan.js");

const SYNTHETIC = "AKIA" + "ABCDEFGHIJKLMNOP";

function git(repo, args) {
  const res = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (res.status !== 0 && args[0] !== "diff") {
    throw new Error(`git ${args.join(" ")} falló: ${res.stderr}`);
  }
  return res;
}

function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-staged-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test("computeStagedScope: lista archivos staged con su contenido del índice", () => {
  const repo = initRepo();
  try {
    write(repo, "a.txt", "hola");
    git(repo, ["add", "a.txt"]);
    const scope = computeStagedScope(repo);
    const a = scope.files.find((f) => f.path === "a.txt");
    assert.ok(a);
    assert.equal(a.change, "A");
    assert.equal(a.content, "hola");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computeStagedScope: excluye contenido unstaged (sólo mira el índice)", () => {
  const repo = initRepo();
  try {
    write(repo, "a.txt", "limpio");
    git(repo, ["add", "a.txt"]);
    // Después de stage, el árbol de trabajo cambia a un secreto, SIN re-stage.
    write(repo, "a.txt", `KEY=${SYNTHETIC}`);
    const scope = computeStagedScope(repo);
    const a = scope.files.find((f) => f.path === "a.txt");
    // El contenido del índice sigue siendo "limpio", no el secreto unstaged.
    assert.equal(a.content, "limpio");
    assert.equal(a.content.includes(SYNTHETIC), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computeStagedScope: maneja rutas con espacios", () => {
  const repo = initRepo();
  try {
    write(repo, "con espacio/archivo con espacio.txt", "x");
    git(repo, ["add", "."]);
    const scope = computeStagedScope(repo);
    assert.ok(scope.files.some((f) => f.path === "con espacio/archivo con espacio.txt"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computeStagedScope: detecta renombrados", () => {
  const repo = initRepo();
  try {
    write(repo, "viejo.txt", "contenido suficiente para rename\n".repeat(5));
    git(repo, ["add", "."]);
    git(repo, ["commit", "-qm", "init"]);
    git(repo, ["mv", "viejo.txt", "nuevo.txt"]);
    const scope = computeStagedScope(repo);
    const r = scope.files.find((f) => f.path === "nuevo.txt");
    assert.ok(r);
    assert.ok(r.change === "R" || r.change === "A"); // según detección de git
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computeStagedScope: borrados no aportan contenido", () => {
  const repo = initRepo();
  try {
    write(repo, "borrar.txt", "x");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-qm", "init"]);
    git(repo, ["rm", "-q", "borrar.txt"]);
    const scope = computeStagedScope(repo);
    const d = scope.files.find((f) => f.path === "borrar.txt");
    assert.equal(d.change, "D");
    assert.equal(d.content, undefined);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computeStagedScope: binario se marca y no trae content de texto", () => {
  const repo = initRepo();
  try {
    const abs = path.join(repo, "bin.dat");
    fs.writeFileSync(abs, Buffer.from([0, 1, 2, 0, 255, 10]));
    git(repo, ["add", "."]);
    const scope = computeStagedScope(repo);
    const b = scope.files.find((f) => f.path === "bin.dat");
    assert.equal(b.binary, true);
    assert.equal(b.content, undefined);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scanStaged: secreto staged en enforce → deny; mismo secreto sólo unstaged → allow", () => {
  const repo = initRepo();
  try {
    clearCache();
    // Secreto staged.
    write(repo, ".env", `KEY=${SYNTHETIC}`);
    git(repo, ["add", ".env"]);
    const denied = scanStaged({ repoRoot: repo, mode: "enforce", noCache: true });
    assert.equal(denied.result.decision, "deny");

    // Nuevo repo: secreto sólo en el árbol (no staged).
    const repo2 = initRepo();
    try {
      write(repo2, "limpio.txt", "sin secreto");
      git(repo2, ["add", "limpio.txt"]);
      write(repo2, ".env", `KEY=${SYNTHETIC}`); // NO se hace add
      const res = scanStaged({ repoRoot: repo2, mode: "enforce", noCache: true });
      assert.equal(res.result.decision, "allow");
    } finally {
      fs.rmSync(repo2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scanStaged: cache por árbol staged devuelve resultado cacheado", () => {
  const repo = initRepo();
  try {
    clearCache();
    write(repo, "a.txt", "hola");
    git(repo, ["add", "a.txt"]);
    const first = scanStaged({ repoRoot: repo, mode: "warning" });
    assert.equal(first.cached, false);
    const second = scanStaged({ repoRoot: repo, mode: "warning" });
    assert.equal(second.cached, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scanStaged: no filtra el valor del secreto en el resultado", () => {
  const repo = initRepo();
  try {
    clearCache();
    write(repo, ".env", `KEY=${SYNTHETIC}`);
    git(repo, ["add", ".env"]);
    const res = scanStaged({ repoRoot: repo, mode: "enforce", noCache: true });
    assert.equal(JSON.stringify(res.result).includes(SYNTHETIC), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
