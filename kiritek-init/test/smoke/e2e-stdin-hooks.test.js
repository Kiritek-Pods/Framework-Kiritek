"use strict";

/**
 * Smoke E2E de los hooks por stdin REAL.
 *
 * Estos tests ejecutan el BINARIO REAL ("node bin/kiritek-init.js <cmd>") en un
 * subproceso y le entregan el evento por el STDIN DEL PROCESO (fd 0), tal como
 * lo hacen Git (pre-push), Claude Code y Kiro en producción. NO inyectan
 * "deps.stdinData": precisamente por eso cubren el camino que la suite de
 * módulos aislados no cubría — el lector de stdin debe leer de fd 0 cuando no
 * hay "--stdin-file" ni dependencia inyectada.
 *
 * Contrato verificado de punta a punta:
 *   - Evento válido canalizado por stdin  -> decision "allow", exit 0.
 *   - stdin vacío                          -> fail-safe "deny", exit 2.
 *   - El stdout/stderr NUNCA filtra un canario sintético.
 *
 * Sin red ni secretos reales.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "..", "bin", "kiritek-init.js");

/** Crea un repo git temporal (sin remoto, sin red). */
function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-e2e-stdin-"));
  spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
  return repo;
}

/**
 * Ejecuta el binario real pasando "input" por el stdin del proceso.
 * NO se usa --stdin-file ni inyección de dependencias: el CLI debe leer fd 0.
 */
function runBinWithStdin(args, input, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input, // <- stdin REAL canalizado al subproceso
    encoding: "utf8",
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch (_) {
    /* los asserts evalúan el stdout crudo */
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function benignEvent(repo) {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: path.join(repo, "README.md") },
    cwd: repo,
  });
}

test("E2E claude-hook: evento válido por stdin real -> allow, exit 0", () => {
  const repo = tmpRepo();
  try {
    const r = runBinWithStdin(["validate", "claude-hook", "--format=json"], benignEvent(repo), repo);
    assert.equal(r.code, 0, "un evento benigno canalizado por stdin debe permitirse");
    assert.ok(r.json, "stdout debe ser JSON parseable");
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E claude-hook: stdin vacío -> fail-safe deny, exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runBinWithStdin(["validate", "claude-hook", "--format=json"], "", repo);
    assert.equal(r.code, 2, "stdin vacío debe bloquear por seguridad");
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E kiro-hook: evento válido por stdin real -> allow, exit 0", () => {
  const repo = tmpRepo();
  try {
    const r = runBinWithStdin(["validate", "kiro-hook", "--format=json"], benignEvent(repo), repo);
    assert.equal(r.code, 0, "un evento benigno canalizado por stdin debe permitirse");
    assert.ok(r.json, "stdout debe ser JSON parseable");
    assert.equal(r.json.decision, "allow");
    assert.equal(r.json.blocked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E kiro-hook: stdin vacío -> fail-safe deny (exit 2)", () => {
  const repo = tmpRepo();
  try {
    const r = runBinWithStdin(["validate", "kiro-hook", "--format=json"], "", repo);
    assert.equal(r.code, 2, "stdin vacío debe bloquear por seguridad");
    assert.equal(r.json.decision, "deny");
    assert.equal(r.json.blocked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("E2E hooks: el output nunca filtra un canario sintético (stdin real)", () => {
  const repo = tmpRepo();
  try {
    const CANARY = "AKIA" + "ABCDEFGHIJKLMNOP";
    const event = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo AWS_KEY=" + CANARY },
      cwd: repo,
    });
    const r = runBinWithStdin(["validate", "claude-hook", "--format=json"], event, repo);
    assert.equal(r.stdout.includes(CANARY), false, "el stdout no debe contener el canario");
    assert.equal(r.stderr.includes(CANARY), false, "el stderr no debe contener el canario");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
