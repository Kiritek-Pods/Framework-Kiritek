"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const { conventionalCommitRate } = require("../src/audit.js");

function gitRepoWithCommits(subjects) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-audit-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@kiritek.com"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  subjects.forEach((subject, i) => {
    fs.writeFileSync(path.join(dir, `file${i}.txt`), String(i));
    execSync(`git add file${i}.txt`, { cwd: dir });
    execSync(`git commit -q -m "${subject}"`, { cwd: dir });
  });
  return dir;
}

test("conventionalCommitRate detecta 100% cuando todos siguen la convención", () => {
  const dir = gitRepoWithCommits(["feat: add login", "fix(auth): null check", "chore: bump deps"]);
  const { conventionalCommitRate: rate, sampleSize } = conventionalCommitRate(dir);
  assert.equal(sampleSize, 3);
  assert.equal(rate, 1);
});

test("conventionalCommitRate detecta 0% cuando ninguno sigue la convención", () => {
  const dir = gitRepoWithCommits(["wip", "arreglos varios", "asdf"]);
  const { conventionalCommitRate: rate, sampleSize } = conventionalCommitRate(dir);
  assert.equal(sampleSize, 3);
  assert.equal(rate, 0);
});

test("conventionalCommitRate calcula proporción mixta", () => {
  const dir = gitRepoWithCommits(["feat: a", "wip", "fix: b", "asdf"]);
  const { conventionalCommitRate: rate } = conventionalCommitRate(dir);
  assert.equal(rate, 0.5);
});

test("conventionalCommitRate en directorio sin git no revienta", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-audit-nogit-"));
  const result = conventionalCommitRate(dir);
  assert.equal(result.conventionalCommitRate, null);
});
