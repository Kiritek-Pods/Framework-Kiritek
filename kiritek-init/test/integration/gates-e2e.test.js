"use strict";

/**
 * Checkpoint 17 — gates locales end-to-end.
 *
 * Demuestra, sobre repos Git reales y los módulos ya construidos (staged-scan,
 * push-scope, policy/git, default-branch), que:
 *  - un placeholder pasa y un secreto sintético staged se bloquea sin aparecer
 *    en la salida;
 *  - un secreto en un commit nuevo de una rama sin upstream queda en el alcance
 *    pre-push;
 *  - push directo a una rama default no estándar y force push se bloquean;
 *  - warning advierte y enforce deniega.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { scanStaged, clearCache } = require("../../src/scanners/staged-scan.js");
const { computePushScope } = require("../../src/git/push-scope.js");
const guard = require("../../src/policy/git.js");

const SYNTHETIC = "AKIA" + "ABCDEFGHIJKLMNOP";

function git(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-e2e-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@e.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}
function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function commit(repo, file, content, msg) {
  write(repo, file, content);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", msg]);
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim();
}

test("17.1: placeholder permitido; secreto staged bloqueado y sin filtrar", () => {
  const repo = initRepo();
  try {
    clearCache();
    // Placeholder: pasa.
    write(repo, ".env.example", "API_KEY=YOUR_API_KEY\n");
    git(repo, ["add", ".env.example"]);
    const ok = scanStaged({ repoRoot: repo, mode: "enforce", noCache: true });
    assert.equal(ok.result.decision, "allow");

    // Secreto real staged: deny, sin filtrar valor.
    write(repo, ".env", `KEY=${SYNTHETIC}`);
    git(repo, ["add", ".env"]);
    const bad = scanStaged({ repoRoot: repo, mode: "enforce", noCache: true });
    assert.equal(bad.result.decision, "deny");
    assert.equal(JSON.stringify(bad.result).includes(SYNTHETIC), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("17.2: commit nuevo en rama sin upstream queda en el alcance pre-push", () => {
  const repo = initRepo();
  try {
    commit(repo, "a.txt", "1", "c1");
    const head = commit(repo, ".env", `KEY=${SYNTHETIC}`, "c2 con secreto");
    const scope = computePushScope({ repoRoot: repo, stdin: `refs/heads/feat ${head} refs/heads/feat ${"0".repeat(40)}`, remote: "origin" });
    assert.ok(scope.commits.includes(head), "el commit con secreto debe estar en el alcance pre-push");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("17.3: push directo a default no estándar y force se bloquean en enforce", () => {
  const direct = guard.evaluateGitCommand({ args: ["push", "origin", "trunk"], mode: "enforce", defaultBranch: "trunk" });
  assert.equal(direct.decision, "deny");
  const force = guard.evaluateGitCommand({ args: ["push", "--force", "origin", "feat"], mode: "enforce", defaultBranch: "trunk" });
  assert.equal(force.decision, "deny");
});

test("17.4: warning advierte y enforce deniega para el mismo secreto staged", () => {
  const repo = initRepo();
  try {
    clearCache();
    write(repo, ".env", `KEY=${SYNTHETIC}`);
    git(repo, ["add", ".env"]);
    const warn = scanStaged({ repoRoot: repo, mode: "warning", noCache: true });
    assert.equal(warn.result.decision, "warn");
    const deny = scanStaged({ repoRoot: repo, mode: "enforce", noCache: true });
    assert.equal(deny.result.decision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
