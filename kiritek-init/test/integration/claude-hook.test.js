"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const securityCli = require("../../src/security-cli.js");

// Secreto SINTÉTICO para pruebas de redacción (patrón AKIA...); no es real.
const SYNTHETIC_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-claude-"));
}

/**
 * Ejecuta `validate claude-hook` inyectando el evento por `stdinData`.
 * Devuelve exit code, stdout crudo, stderr y el JSON parseado de stdout.
 */
function runHook(event, { cwd, mode } = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  const argv = ["validate", "claude-hook", "--format=json"];
  if (mode) argv.push(`--mode=${mode}`);
  const code = securityCli.run(argv, {
    cwd: cwd || tmpRepo(),
    env: {},
    stdout,
    stderr,
    stdinData: typeof event === "string" ? event : JSON.stringify(event),
  });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) {
    /* algunas rutas emiten JSON en una línea */
    try {
      json = JSON.parse(out.trim().split("\n").pop());
    } catch (_) {
      json = null;
    }
  }
  return { code, out, err, json };
}

test("claude-hook: Write a .env (enforce) → deny + exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(repo, ".env"), content: "SECRET=1" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook: Write de código normal (enforce) → allow + exit 0", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(repo, "src/x.js"), content: "const x = 1;" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 0);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook: Bash git push --no-verify → deny + exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git push --no-verify origin feature" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook FAIL-SAFE: stdin vacío → deny + exit 2 (nunca allow)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook("", { cwd: repo, mode: "enforce" });
    assert.equal(r.code, 2);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook FAIL-SAFE: JSON inválido → deny + exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook("{ no es json", { cwd: repo, mode: "enforce" });
    assert.equal(r.code, 2);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook FAIL-SAFE: evento equivocado → deny + exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook: razón de deny no filtra el secreto sintético", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(repo, ".env.example"), content: `AWS=${SYNTHETIC_AWS_KEY}` },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    // Ni stdout (razón) ni stderr contienen el valor sintético.
    assert.ok(!r.out.includes(SYNTHETIC_AWS_KEY), "stdout no debe filtrar el secreto");
    assert.ok(!r.err.includes(SYNTHETIC_AWS_KEY), "stderr no debe filtrar el secreto");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook: tool MCP → allow (no interceptable por contenido)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "mcp__jira__create_issue",
        tool_input: { summary: "x" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 0);
    assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claude-hook: adaptador de Claude aparece en la auditoría de capacidades", () => {
  const repo = tmpRepo();
  try {
    const cap = require("../../src/audit/capabilities.js");
    const audit = cap.runCapabilityAudit(repo);
    const claudeCap = audit.capabilities.find((c) => c.id === "assistant-claude");
    assert.ok(claudeCap, "debe existir la capacidad assistant-claude");
    // Repo sin instalar el adaptador: no instalado.
    assert.equal(claudeCap.installed, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
