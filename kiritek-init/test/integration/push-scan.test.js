"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { scanPush } = require("../../src/scanners/push-scan.js");
const ci = require("../../src/integrations/ci.js");

const SYNTHETIC = "AKIA" + "ABCDEFGHIJKLMNOP";
const ZEROS = "0".repeat(40);

function git(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-pushscan-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@e.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}
function commit(repo, file, content, msg) {
  const abs = path.join(repo, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", msg]);
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim();
}

test("scanPush: secreto en commit nuevo de rama sin upstream → deny", () => {
  const repo = initRepo();
  try {
    commit(repo, "a.txt", "limpio", "c1");
    const head = commit(repo, ".env", `KEY=${SYNTHETIC}`, "c2 secreto");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const { result } = scanPush({ repoRoot: repo, stdin, mode: "enforce" });
    assert.equal(result.decision, "deny");
    assert.equal(JSON.stringify(result).includes(SYNTHETIC), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scanPush: commits limpios → allow", () => {
  const repo = initRepo();
  try {
    commit(repo, "a.txt", "limpio", "c1");
    const head = commit(repo, "b.txt", "tambien limpio", "c2");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const { result } = scanPush({ repoRoot: repo, stdin, mode: "enforce" });
    assert.equal(result.decision, "allow");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scanPush: warning advierte en vez de denegar", () => {
  const repo = initRepo();
  try {
    const head = commit(repo, ".env", `KEY=${SYNTHETIC}`, "c1 secreto");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const { result } = scanPush({ repoRoot: repo, stdin, mode: "warning" });
    assert.equal(result.decision, "warn");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- ci plan ---

test("ci.scopeForEvent: PR→range, push→repository, schedule full→history", () => {
  assert.equal(ci.scopeForEvent("pull_request"), "range");
  assert.equal(ci.scopeForEvent("push"), "repository");
  assert.equal(ci.scopeForEvent("schedule", { historyDepth: "full" }), "history");
});

test("ci.scopeForEvent: evento desconocido lanza", () => {
  assert.throws(() => ci.scopeForEvent("weird"), /desconocido/);
});

test("ci.planCiRun: checkout shallow con alcance history → historial insuficiente", () => {
  const plan = ci.planCiRun({ event: "schedule", historyDepth: "full", shallow: true, mode: "enforce" });
  assert.equal(plan.scope, "history");
  assert.equal(plan.history.sufficient, false);
});

test("ci.planCiRun: PR con historial completo es suficiente", () => {
  const plan = ci.planCiRun({ event: "pull_request", shallow: false, mode: "enforce" });
  assert.equal(plan.scope, "range");
  assert.equal(plan.history.sufficient, true);
});
