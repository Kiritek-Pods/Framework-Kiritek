"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const kiro = require("../../src/integrations/kiro.js");
const { findCanaries } = require("../../src/scanners/redactor.js");

// Secreto SINTÉTICO sólo para pruebas de redacción (coincide con el patrón de
// canario AKIA[0-9A-Z]{16}); no es una credencial real.
const SYNTHETIC_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const REPO = process.platform === "win32" ? "C:\\repo" : "/repo";

function abs(rel) {
  return path.join(REPO, rel);
}

// --- clasificación de tools / matchers ---

test("classifyTool: fs_write/write/str_replace → write; execute_bash/shell/use_aws → command; otro → unknown", () => {
  assert.equal(kiro.classifyTool("fs_write"), kiro.TOOL_KIND.WRITE);
  assert.equal(kiro.classifyTool("write"), kiro.TOOL_KIND.WRITE);
  assert.equal(kiro.classifyTool("str_replace"), kiro.TOOL_KIND.WRITE);
  assert.equal(kiro.classifyTool("execute_bash"), kiro.TOOL_KIND.COMMAND);
  assert.equal(kiro.classifyTool("shell"), kiro.TOOL_KIND.COMMAND);
  assert.equal(kiro.classifyTool("use_aws"), kiro.TOOL_KIND.COMMAND);
  assert.equal(kiro.classifyTool("read_file"), kiro.TOOL_KIND.UNKNOWN);
  assert.equal(kiro.classifyTool(""), kiro.TOOL_KIND.UNKNOWN);
});

test("MATCHERS cubren escritura y comando (regex por nombre de tool)", () => {
  assert.match("fs_write", new RegExp(kiro.MATCHERS.WRITE));
  assert.match("str_replace", new RegExp(kiro.MATCHERS.WRITE));
  assert.match("execute_bash", new RegExp(kiro.MATCHERS.COMMAND));
  assert.match("use_aws", new RegExp(kiro.MATCHERS.COMMAND));
});

// --- normalización de rutas ---

test("normalizeToolPath: absoluta dentro del repo → relativa POSIX", () => {
  assert.equal(kiro.normalizeToolPath(abs("src/app.js"), REPO), "src/app.js");
});

test("normalizeToolPath: relativa al cwd → relativa POSIX", () => {
  assert.equal(kiro.normalizeToolPath("src/app.js", REPO), "src/app.js");
});

test("normalizeToolPath: fuera del repo → null (no escapa)", () => {
  const outside = process.platform === "win32" ? "C:\\other\\x" : "/other/x";
  assert.equal(kiro.normalizeToolPath(outside, REPO), null);
});

// --- extracción de tool_input (sólo claves documentadas) ---

test("writePathsFromInput lee `path` (fs_write/str_replace) y `file_path`", () => {
  assert.deepEqual(kiro.writePathsFromInput({ path: "a.js" }), ["a.js"]);
  assert.deepEqual(kiro.writePathsFromInput({ file_path: "b.js" }), ["b.js"]);
  assert.deepEqual(kiro.writePathsFromInput({ other: "x" }), []);
});

test("writeContentFromInput lee text/content/new_str/newStr", () => {
  assert.equal(kiro.writeContentFromInput({ text: "hola" }), "hola");
  assert.equal(kiro.writeContentFromInput({ new_str: "x" }), "x");
  assert.equal(kiro.writeContentFromInput({ newStr: "y" }), "y");
  assert.equal(kiro.writeContentFromInput({}), undefined);
});

// --- tokenización de comando (sin shell) ---

test("tokenizeCommand respeta comillas y no ejecuta nada", () => {
  const toks = kiro.tokenizeCommand('git commit -m "mensaje con espacios"');
  assert.deepEqual(toks, ["git", "commit", "-m", "mensaje con espacios"]);
});

test("gitInvocations extrae segmentos git de comandos encadenados", () => {
  const inv = kiro.gitInvocations("cd foo && git push origin main --force");
  assert.equal(inv.length, 1);
  assert.deepEqual(inv[0], ["push", "origin", "main", "--force"]);
});

// --- evaluación: escritura de archivo sensible → deny + exit 2 ---

test("evaluateEvent: fs_write a .env → deny + exit 2 (enforce)", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "fs_write",
      tool_input: { path: abs(".env"), text: "API=1" },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.exitCode, kiro.EXIT.BLOCK);
  assert.equal(r.blocking, true);
});

test("evaluateEvent: fs_write de código normal → allow + exit 0", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "fs_write",
      tool_input: { path: abs("src/index.js"), text: "export const x = 1;" },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.exitCode, kiro.EXIT.ALLOW);
  assert.equal(r.blocking, false);
});

test("evaluateEvent: str_replace que introduce secreto en .env.example → deny (allowlist no anula contenido)", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "str_replace",
      tool_input: { path: abs(".env.example"), new_str: `AWS=${SYNTHETIC_AWS_KEY}` },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.exitCode, kiro.EXIT.BLOCK);
  // La razón NUNCA contiene el valor sintético.
  assert.equal(findCanaries(r.reason).length, 0);
  assert.ok(!r.reason.includes(SYNTHETIC_AWS_KEY));
});

// --- warning: warn → exit 0 (NO hay ask en Kiro) ---

test("evaluateEvent: warning para archivo sensible → exit 0 (no bloquea, no ask)", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "fs_write",
      tool_input: { path: abs(".env"), text: "API=1" },
      cwd: REPO,
    },
    { mode: "warning" }
  );
  assert.equal(r.decision, "warn");
  assert.equal(r.exitCode, kiro.EXIT.ALLOW);
  assert.equal(r.blocking, false);
});

// --- evaluación: comando git peligroso → deny + exit 2 ---

test("evaluateEvent: execute_bash git push --no-verify → deny + exit 2", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "execute_bash",
      tool_input: { command: "git push --no-verify origin feature" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.exitCode, kiro.EXIT.BLOCK);
  assert.equal(r.blocking, true);
});

test("evaluateEvent: execute_bash git push directo a default → deny + exit 2", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "execute_bash",
      tool_input: { command: "git push origin main" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.exitCode, kiro.EXIT.BLOCK);
});

test("evaluateEvent: execute_bash git push --force → deny + exit 2", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "execute_bash",
      tool_input: { command: "git push --force origin feature" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.exitCode, kiro.EXIT.BLOCK);
});

test("evaluateEvent: execute_bash comando inocuo → exit 0", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "execute_bash",
      tool_input: { command: "npm test" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.exitCode, kiro.EXIT.ALLOW);
});

// --- use_aws: no interceptable por contenido (git/CI cubren) → exit 0 ---

test("evaluateEvent: use_aws (sin comando git) → exit 0, no bloquea", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "use_aws",
      tool_input: { service: "s3", operation: "list-buckets" },
      cwd: REPO,
    },
    { mode: "enforce", defaultBranch: "main" }
  );
  assert.equal(r.exitCode, kiro.EXIT.ALLOW);
  assert.equal(r.blocking, false);
});

// --- tool desconocida: no interceptable → allow + flag ---

test("evaluateEvent: tool desconocida → exit 0 pero marcada no interceptable", () => {
  const r = kiro.evaluateEvent(
    {
      hook_event_name: "PreToolUse",
      tool_name: "read_file",
      tool_input: { path: abs("x.js") },
      cwd: REPO,
    },
    { mode: "enforce" }
  );
  assert.equal(r.exitCode, kiro.EXIT.ALLOW);
  assert.equal(r.uninterceptable, true);
});

// --- parseStdin defensivo (fail-safe lo decide el llamador) ---

test("parseStdin: vacío/JSON inválido/objeto incompleto → ok:false", () => {
  assert.equal(kiro.parseStdin("").ok, false);
  assert.equal(kiro.parseStdin("no json").ok, false);
  assert.equal(kiro.parseStdin("[]").ok, false);
  assert.equal(kiro.parseStdin(JSON.stringify({ tool_name: 123 })).ok, false);
  assert.equal(
    kiro.parseStdin(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "fs_write" })).ok,
    false
  );
});

test("parseStdin: evento válido → ok:true", () => {
  const r = kiro.parseStdin(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "execute_bash", tool_input: { command: "ls" } })
  );
  assert.equal(r.ok, true);
  assert.equal(r.event.tool_name, "execute_bash");
});

// --- buildHookDefinition: formato v1 esperado por Kiro ---

test("buildHookDefinition: produce formato version v1 con trigger/matcher/action.command", () => {
  const def = kiro.buildHookDefinition({
    name: "Kiritek Security - write guard",
    matcher: kiro.MATCHERS.WRITE,
    command: "sh .kiritek/adapters/kiro/pretooluse.sh",
  });
  assert.equal(def.version, "v1");
  assert.equal(def.hooks.length, 1);
  assert.equal(def.hooks[0].trigger, "PreToolUse");
  assert.equal(def.hooks[0].matcher, kiro.MATCHERS.WRITE);
  assert.equal(def.hooks[0].action.type, "command");
  assert.ok(def.hooks[0].action.command.includes("pretooluse.sh"));
});
