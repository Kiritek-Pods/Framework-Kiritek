"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const paths = require("../../src/platform/paths.js");
const pre = require("../../src/platform/preflight.js");

const IS_WINDOWS = process.platform === "win32";

function git(repo, args) {
  const res = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} falló: ${res.stderr}`);
  }
  return res;
}

function initRepo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix || "kiritek-plat-"));
  // realpath para evitar que /var vs /private/var en macOS confunda contención.
  const real = fs.realpathSync(repo);
  git(real, ["init", "-q"]);
  git(real, ["config", "user.email", "test@example.com"]);
  git(real, ["config", "user.name", "test"]);
  git(real, ["config", "commit.gpgsign", "false"]);
  return real;
}

function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function commitAll(repo, msg) {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", msg]);
}

test("resolveGitRoot: resuelve la raíz desde un subdirectorio (monorepo)", () => {
  const repo = initRepo();
  try {
    write(repo, "packages/app/src/index.js", "module.exports = 1;\n");
    commitAll(repo, "init");
    const sub = path.join(repo, "packages", "app", "src");
    const r = paths.resolveGitRoot(sub);
    assert.equal(r.ok, true);
    assert.equal(r.repoRoot, repo);
    assert.equal(r.isLinkedWorktree, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveGitRoot: fuera de un repo → ok=false con razón", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-nogit-"));
  const real = fs.realpathSync(dir);
  try {
    const r = paths.resolveGitRoot(real);
    assert.equal(r.ok, false);
    assert.ok(r.reason.length > 0);
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
  }
});

test("resolveGitRoot + detectLinkedWorktree: worktree enlazado tiene .git ARCHIVO", () => {
  const repo = initRepo();
  let wt = null;
  try {
    write(repo, "a.txt", "hola\n");
    commitAll(repo, "init");
    git(repo, ["branch", "feature"]);
    wt = path.join(path.dirname(repo), path.basename(repo) + "-wt");
    git(repo, ["worktree", "add", "-q", wt, "feature"]);
    const wtReal = fs.realpathSync(wt);

    // En un worktree enlazado, .git es un archivo con puntero gitdir:
    const dotGit = path.join(wtReal, ".git");
    assert.equal(fs.lstatSync(dotGit).isFile(), true);

    const det = paths.detectLinkedWorktree(wtReal);
    assert.equal(det.linked, true);
    assert.ok(det.gitdirPointer);

    const r = paths.resolveGitRoot(wtReal);
    assert.equal(r.ok, true);
    assert.equal(r.repoRoot, wtReal);
    assert.equal(r.isLinkedWorktree, true);
    assert.ok(r.commonDir); // common dir compartido con el principal
  } finally {
    if (wt) {
      try {
        git(repo, ["worktree", "remove", "--force", wt]);
      } catch (_) {
        /* best-effort */
      }
      fs.rmSync(wt, { recursive: true, force: true });
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveGitRoot: rutas con espacios y Unicode", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-space "));
  const repoDir = path.join(base, "món répo con espacio");
  fs.mkdirSync(repoDir, { recursive: true });
  const repo = fs.realpathSync(repoDir);
  try {
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "t@e.com"]);
    git(repo, ["config", "user.name", "t"]);
    write(repo, "sub carpeta/árchïvo.txt", "x\n");
    const r = paths.resolveGitRoot(path.join(repo, "sub carpeta"));
    assert.equal(r.ok, true);
    assert.equal(r.repoRoot, repo);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("containReal: ruta normal dentro del repo → contenida", () => {
  const repo = initRepo();
  try {
    write(repo, "sub/a.txt", "x\n");
    const r = paths.containReal(repo, path.join(repo, "sub", "a.txt"));
    assert.equal(r.contained, true);
    assert.equal(r.escape, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("containReal: ruta inexistente dentro del repo sigue siendo contenida", () => {
  const repo = initRepo();
  try {
    const r = paths.containReal(repo, path.join(repo, "aun", "no", "existe.txt"));
    assert.equal(r.contained, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("containReal: symlink que apunta FUERA del repo se RECHAZA como escape", (t) => {
  if (IS_WINDOWS) {
    // Skip registrado con razón: symlinks requieren privilegio en Windows.
    t.skip("symlink no soportado sin privilegio en Windows (capacidad POSIX declarada no disponible)");
    return;
  }
  const repo = initRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-outside-"));
  const outsideReal = fs.realpathSync(outside);
  try {
    const secret = path.join(outsideReal, "secreto.txt");
    fs.writeFileSync(secret, "contenido externo\n");
    const link = path.join(repo, "escape-link");
    fs.symlinkSync(outsideReal, link);

    // Una ruta que entra por el symlink resuelve fuera del repo.
    const r = paths.containReal(repo, path.join(link, "secreto.txt"));
    assert.equal(r.escape, true);
    assert.equal(r.contained, false);
    assert.match(r.reason, /fuera del repo/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outsideReal, { recursive: true, force: true });
  }
});

test("containReal: symlink interno (apunta dentro del repo) NO es escape", (t) => {
  if (IS_WINDOWS) {
    t.skip("symlink no soportado sin privilegio en Windows (capacidad POSIX declarada no disponible)");
    return;
  }
  const repo = initRepo();
  try {
    const realDir = path.join(repo, "real");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "a.txt"), "x\n");
    const link = path.join(repo, "alias");
    fs.symlinkSync(realDir, link);
    const r = paths.containReal(repo, path.join(link, "a.txt"));
    assert.equal(r.contained, true);
    assert.equal(r.escape, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("hasExecBit: en POSIX refleja el modo; en Windows no aplica con razón", (t) => {
  const repo = initRepo();
  try {
    const script = path.join(repo, "hook.sh");
    fs.writeFileSync(script, "#!/bin/sh\necho hi\n");
    if (IS_WINDOWS) {
      const r = paths.hasExecBit(script, "win32");
      assert.equal(r.applicable, false);
      assert.ok(r.reason.length > 0);
      t.diagnostic("exec-bit no aplica en Windows (capacidad POSIX declarada no disponible)");
      return;
    }
    fs.chmodSync(script, 0o755);
    const r = paths.hasExecBit(script);
    assert.equal(r.applicable, true);
    assert.equal(r.executable, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("preflight (integración): sobre un repo real resuelve y permite mutar", () => {
  const repo = initRepo();
  try {
    const res = pre.preflight({ repoRoot: repo, arch: process.arch, offline: true });
    // En entorno de pruebas con Node>=18 y Git disponibles, debe poder mutar.
    assert.equal(res.readOnly, true);
    assert.equal(res.canMutate, true, JSON.stringify(res.hardFailures));
    const repoCheck = res.checks.find((c) => c.id === "repo");
    assert.equal(repoCheck.severity, "ok");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("preflight (integración): directorio sin permiso de escritura bloquea (POSIX)", (t) => {
  if (IS_WINDOWS) {
    t.skip("permisos rwx estilo POSIX no aplican en Windows (capacidad declarada no disponible)");
    return;
  }
  if (process.getuid && process.getuid() === 0) {
    t.skip("ejecutando como root: W_OK no se puede denegar de forma fiable");
    return;
  }
  const repo = initRepo();
  try {
    fs.chmodSync(repo, 0o500); // r-x: sin escritura
    const res = pre.preflight({ repoRoot: repo, arch: process.arch, offline: true });
    assert.equal(res.canMutate, false);
    assert.ok(res.hardFailures.some((c) => c.id === "permissions"));
  } finally {
    fs.chmodSync(repo, 0o700); // restaurar para poder borrar
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
