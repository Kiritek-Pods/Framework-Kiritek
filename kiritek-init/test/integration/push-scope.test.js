"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ps = require("../../src/git/push-scope.js");

function git(repo, args, opts = {}) {
  const res = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", ...opts });
  return res;
}
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-push-"));
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
const ZEROS = "0".repeat(40);

// --- parser ---

test("parsePrePushStdin: clasifica create/update/delete y tags", () => {
  const sha = "a".repeat(40);
  const other = "b".repeat(40);
  const stdin = [
    `refs/heads/feat ${sha} refs/heads/feat ${ZEROS}`, // create
    `refs/heads/main ${sha} refs/heads/main ${other}`, // update
    `${ZEROS} ${ZEROS} refs/heads/old ${other}`, // delete (local cero)
    `refs/tags/v1 ${sha} refs/tags/v1 ${ZEROS}`, // tag create
  ].join("\n");
  const parsed = ps.parsePrePushStdin(stdin);
  assert.equal(parsed[0].kind, "create");
  assert.equal(parsed[1].kind, "update");
  assert.equal(parsed[2].kind, "delete");
  assert.equal(parsed[3].isTag, true);
});

test("parsePrePushStdin: línea malformada (menos de 4 campos) se rechaza", () => {
  assert.throws(() => ps.parsePrePushStdin("solo tres campos"), /malformada/);
});

test("parsePrePushStdin: SHA inválido se rechaza", () => {
  assert.throws(() => ps.parsePrePushStdin(`refs/heads/x NOTASHA refs/heads/x ${ZEROS}`), /inválido/);
});

test("parsePrePushStdin: fuzz de líneas no revienta y clasifica o rechaza", () => {
  const samples = [
    "",
    "   ",
    `refs/heads/a ${"a".repeat(40)} refs/heads/a ${ZEROS}`,
    `${ZEROS} ${ZEROS} refs/heads/a ${"b".repeat(40)}`,
  ];
  for (const s of samples) {
    try {
      ps.parsePrePushStdin(s);
    } catch (e) {
      assert.match(e.message, /malformada|inválido/);
    }
  }
});

// --- alcance con repos reales ---

test("computePushScope: rama nueva sin upstream cubre todos sus commits nuevos", () => {
  const repo = initRepo();
  try {
    commit(repo, "a.txt", "1", "c1");
    const head = commit(repo, "b.txt", "2", "c2");
    // Push de rama nueva: remoteSha ceros, sin tips remotos conocidos.
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const scope = ps.computePushScope({ repoRoot: repo, stdin, remote: "origin" });
    // Debe cubrir ambos commits (no hay base remota).
    assert.ok(scope.commits.length >= 2);
    assert.ok(scope.commits.includes(head));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computePushScope: update usa rango remoteSha..localSha", () => {
  const repo = initRepo();
  try {
    const base = commit(repo, "a.txt", "1", "c1");
    const tip = commit(repo, "a.txt", "2", "c2");
    const stdin = `refs/heads/main ${tip} refs/heads/main ${base}`;
    const scope = ps.computePushScope({ repoRoot: repo, stdin });
    assert.deepEqual(scope.commits, [tip]); // sólo el commit nuevo
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computePushScope: delete no aporta commits", () => {
  const repo = initRepo();
  try {
    commit(repo, "a.txt", "1", "c1");
    const stdin = `${ZEROS} ${ZEROS} refs/heads/old ${"b".repeat(40)}`;
    const scope = ps.computePushScope({ repoRoot: repo, stdin });
    assert.equal(scope.commits.length, 0);
    assert.equal(scope.deletes.length, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("computePushScope: pushes múltiples deduplican commits y registran razón por ref", () => {
  const repo = initRepo();
  try {
    const base = commit(repo, "a.txt", "1", "c1");
    const tip = commit(repo, "a.txt", "2", "c2");
    const stdin = [
      `refs/heads/main ${tip} refs/heads/main ${base}`,
      `refs/heads/copy ${tip} refs/heads/copy ${base}`,
    ].join("\n");
    const scope = ps.computePushScope({ repoRoot: repo, stdin });
    assert.equal(scope.commits.length, 1); // deduplicado
    assert.equal(scope.reasons.length, 2); // una razón por ref
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
