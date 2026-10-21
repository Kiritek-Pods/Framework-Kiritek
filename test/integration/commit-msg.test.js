"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "..", "bin", "kiritek-init.js");
const HOOK_TEMPLATE = path.join(__dirname, "..", "..", "templates", "core", "security", "hooks", "commit-msg");

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-commitmsg-"));
  spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
  return repo;
}

/** Invoca el CLI real `validate commit` sobre un archivo de mensaje. */
function validateCommit(repo, message, extraArgs = []) {
  const msgPath = path.join(repo, "COMMIT_EDITMSG");
  fs.writeFileSync(msgPath, message);
  const r = spawnSync(
    process.execPath,
    [BIN, "validate", "commit", "--format=json", `--message-file=${msgPath}`, ...extraArgs],
    { cwd: repo, encoding: "utf8" }
  );
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch (_) {
    /* se evalúa el stdout crudo en los asserts */
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

test("CLI real: commit convencional válido → exit 0 y decision allow", () => {
  const repo = tmpRepo();
  try {
    const r = validateCommit(repo, "feat: implementa validación de commits\n");
    assert.equal(r.code, 0);
    assert.equal(r.json.decision, "allow");
    assert.equal(r.json.validation, "syntactic");
    assert.equal(r.json.remoteVerification, "unverified");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI real: commit inválido en enforce → exit 1 y decision deny", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(
      path.join(repo, "kiritek-security.config.json"),
      JSON.stringify({ version: 1, mode: "enforce" })
    );
    const r = validateCommit(repo, "mensaje sin tipo convencional\n");
    assert.equal(r.code, 1);
    assert.equal(r.json.decision, "deny");
    assert.match(r.stderr, /kiritek ✖ mensaje de commit bloqueado/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI real: en warning un commit inválido advierte pero no bloquea (exit 0)", () => {
  const repo = tmpRepo();
  try {
    const r = validateCommit(repo, "nope sin formato\n");
    assert.equal(r.code, 0);
    assert.equal(r.json.decision, "warn");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI real: el output nunca filtra el canario sintético", () => {
  const repo = tmpRepo();
  try {
    const CANARY = "AKIA" + "ABCDEFGHIJKLMNOP";
    const r = validateCommit(repo, `feat: algo\n\nAWS_KEY=${CANARY}\n`);
    assert.equal(r.stdout.includes(CANARY), false, "el stdout no debe contener el canario");
    assert.equal(r.stderr.includes(CANARY), false, "el stderr no debe contener el canario");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Hook commit-msg real: lo ejecutamos con un `kiritek-init` en el PATH que
// apunta al bin del proyecto, demostrando el enrutado end-to-end. ---

function makeShim(dir) {
  const shim = path.join(dir, "kiritek-init");
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
  return shim;
}

test("hook commit-msg real: enruta al CLI y bloquea en enforce", { skip: process.platform === "win32" ? "hook sh no portable a Windows" : false }, () => {
  const repo = tmpRepo();
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-bin-"));
  try {
    fs.mkdirSync(path.join(repo, ".kiritek", "hooks"), { recursive: true });
    const hookPath = path.join(repo, ".git", "hooks", "commit-msg");
    fs.copyFileSync(HOOK_TEMPLATE, hookPath);
    fs.chmodSync(hookPath, 0o755);
    fs.writeFileSync(
      path.join(repo, "kiritek-security.config.json"),
      JSON.stringify({ version: 1, mode: "enforce" })
    );
    makeShim(binDir);

    const msgPath = path.join(repo, "COMMIT_EDITMSG");
    fs.writeFileSync(msgPath, "mensaje sin formato convencional\n");

    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
    const r = spawnSync("sh", [hookPath, msgPath], { cwd: repo, encoding: "utf8", env });
    assert.notEqual(r.status, 0, "el hook debe bloquear un commit inválido en enforce");
    // En la terminal sólo el resumen; el JSON completo queda en .kiritek/tmp/.
    assert.match(r.stderr, /kiritek ✖ mensaje de commit bloqueado/);
    assert.equal(r.stdout.includes("{"), false, "el hook no imprime el JSON en la terminal");
    const report = JSON.parse(fs.readFileSync(path.join(repo, ".kiritek", "tmp", "commit-msg.json"), "utf8"));
    assert.equal(report.decision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test("hook commit-msg real: commit válido pasa (exit 0)", { skip: process.platform === "win32" ? "hook sh no portable a Windows" : false }, () => {
  const repo = tmpRepo();
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-bin-"));
  try {
    fs.mkdirSync(path.join(repo, ".kiritek", "hooks"), { recursive: true });
    const hookPath = path.join(repo, ".git", "hooks", "commit-msg");
    fs.copyFileSync(HOOK_TEMPLATE, hookPath);
    fs.chmodSync(hookPath, 0o755);
    makeShim(binDir);

    const msgPath = path.join(repo, "COMMIT_EDITMSG");
    fs.writeFileSync(msgPath, "feat: cambio válido\n");

    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
    const r = spawnSync("sh", [hookPath, msgPath], { cwd: repo, encoding: "utf8", env });
    assert.equal(r.status, 0, "el hook debe permitir un commit válido");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
