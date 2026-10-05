"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const claude = require("../../src/integrations/claude.js");
const { findCanaries } = require("../../src/scanners/redactor.js");

// Secreto SINTÉTICO sólo para pruebas de redacción (coincide con el patrón de
// canario AKIA[0-9A-Z]{16}); no es una credencial real.
const SYNTHETIC_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const REPO = process.platform === "win32" ? "C:\\repo" : "/repo";

function abs(rel) {
  return path.join(REPO, rel);
}

// --- clasificación de tools / matchers ---

test("classifyTool: Edit/Write → write; Bash → command; mcp__ → mcp; otro → unknown", () => {
  assert.equal(claude.classifyTool("Edit"), claude.TOOL_KIND.WRITE);
  assert.equal(claude.classifyTool("Write"), claude.TOOL_KIND.WRITE);
  assert.equal(claude.classifyTool("Bash"), claude.TOOL_KIND.COMMAND);
  assert.equal(claude.classifyTool("mcp__jira__create"), claude.TOOL_KIND.MCP);
  assert.equal(claude.classifyTool("Read"), claude.TOOL_KIND.UNKNOWN);
  assert.equal(claude.classifyTool(""), claude.TOOL_KIND.UNKNOWN);
});

test("MATCHERS cubren escritura, comando y MCP", () => {
  assert.match("Edit", new RegExp(claude.MATCHERS.WRITE));
  assert.match("Write", new RegExp(claude.MATCHERS.WRITE));
  assert.match("Bash", new RegExp(claude.MATCHERS.COMMAND));
  assert.match("mcp__x__y", new RegExp(claude.MATCHERS.MCP));
});

// --- normalización de rutas ---

test("normalizeToolPath: absoluta dentro del repo → relativa POSIX", () => {
  assert.equal(claude.normalizeToolPath(abs("src/app.js"), REPO), "src/app.js");
});

test("normalizeToolPath: fuera del repo → null (no escapa)", () => {
  const outside = process.platform === "win32" ? "C:\\other\\x" : "/other/x";
  assert.equal(claude.normalizeToolPath(outside, REPO), null);
});

// --- tokenización de comando (sin shell) ---

test("tokenizeCommand respeta comillas y no ejecuta nada", () => {
  const toks = claude.tokenizeCommand('git commit -m "mensaje con espacios"');
  assert.deepEqual(toks, ["git", "commit", "-m", "mensaje con espacios"]);
});

test("gitInvocations extrae segmentos git de comandos encadenados", () => {
  const inv = claude.gitInvocations("cd foo && git push origin main --force");
  assert.equal(inv.length, 1);
  assert.deepEqual(inv[0], ["push", "origin", "main", "--force"]);
});

// --- evaluación: escritura de archivo sensible → deny + exit 2 ---

test("evaluateEvent: Write a .env → deny (enforce)", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: abs(".env"), content: "API=1" },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.permission, claude.PERMISSION.DENY);
  assert.equal(r.blocking, true);
});

test("evaluateEvent: Write de código normal → allow", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: abs("src/index.js"), content: "export const x = 1;" },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.permission, claude.PERMISSION.ALLOW);
  assert.equal(r.blocking, false);
});

test("evaluateEvent: archivo de ejemplo con secreto real → deny (allowlist no anula contenido)", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: abs(".env.example"), content: `AWS=${SYNTHETIC_AWS_KEY}` },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.permission, claude.PERMISSION.DENY);
  // La razón NUNCA contiene el valor sintético.
  assert.equal(findCanaries(r.reason).length, 0);
  assert.ok(!r.reason.includes(SYNTHETIC_AWS_KEY));
});

// --- evaluación: comando git peligroso → deny ---

test("evaluateEvent: Bash git push --no-verify → deny", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push --no-verify origin feature" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.permission, claude.PERMISSION.DENY);
  assert.equal(r.blocking, true);
});

test("evaluateEvent: Bash git push directo a default → deny", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.permission, claude.PERMISSION.DENY);
});

test("evaluateEvent: Bash git push --force a rama de feature → deny", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push --force origin feature" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.permission, claude.PERMISSION.DENY);
});

test("evaluateEvent: Bash comando inocuo → allow", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.permission, claude.PERMISSION.ALLOW);
});

// --- riesgo medio configurable: warn → ask ---

test("evaluateEvent: warning + askOnWarn → ask para archivo sensible", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: abs(".env"), content: "API=1" },
      cwd: REPO,
    },
    { mode: "warning", askOnWarn: true }
  );
  assert.equal(r.permission, claude.PERMISSION.ASK);
  assert.equal(r.blocking, false);
});

// --- MCP: no interceptable, allow + flag ---

test("evaluateEvent: tool MCP → allow pero marcada no interceptable", () => {
  const r = claude.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "mcp__jira__create_issue",
      tool_input: { summary: "x" },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.permission, claude.PERMISSION.ALLOW);
  assert.equal(r.uninterceptable, true);
});

// --- parseStdin defensivo (fail-safe lo decide el llamador) ---

test("parseStdin: vacío/JSON inválido/objeto incompleto → ok:false", () => {
  assert.equal(claude.parseStdin("").ok, false);
  assert.equal(claude.parseStdin("no json").ok, false);
  assert.equal(claude.parseStdin("[]").ok, false);
  assert.equal(claude.parseStdin(JSON.stringify({ tool_name: 123 })).ok, false);
  assert.equal(
    claude.parseStdin(JSON.stringify({ hook_event_name: "Other", tool_name: "Bash" })).ok,
    false
  );
});

test("parseStdin: evento válido → ok:true", () => {
  const r = claude.parseStdin(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } })
  );
  assert.equal(r.ok, true);
  assert.equal(r.event.tool_name, "Bash");
});

// --- buildHookOutput: forma esperada por Claude ---

test("buildHookOutput: deny incluye permissionDecisionReason", () => {
  const out = claude.buildHookOutput({
    permission: claude.PERMISSION.DENY,
    reason: "bloqueado",
  });
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, "bloqueado");
});
