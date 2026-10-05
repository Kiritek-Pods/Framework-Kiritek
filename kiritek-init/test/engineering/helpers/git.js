"use strict";

// Repos Git temporales aislados de la config global (hooks, firma, rama).
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_ARGS = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false"];

function git(cwd, ...args) {
  const res = spawnSync("git", [...BASE_ARGS, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} falló: ${res.stderr}`);
  return res.stdout.trim();
}

function write(root, rel, content = `${rel}\n`) {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function initRepo(prefix = "kiritek-eng-git-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dir, "init", "-q");
  return dir;
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

module.exports = { git, write, initRepo, commitAll };
