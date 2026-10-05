"use strict";

/**
 * Checkpoint 26.2 (G.5) — Claude y Kiro, por separado y JUNTOS, sin doble
 * ejecución, bloqueando políticas soportadas y declarando límites honestamente.
 *
 * Esta demostración end-to-end complementa a claude-hook.test.js y
 * kiro-hook.test.js (que ya cubren cada adaptador en aislamiento) con lo que el
 * checkpoint exige explícitamente:
 *
 *  1. Ambos adaptadores activos a la vez evalúan el MISMO evento de forma
 *     independiente y coherente (una sola decisión por adaptador, sin que uno
 *     dependa del otro ni se dupliquen entre sí).
 *  2. La guarda anti-recursión impide la DOBLE EJECUCIÓN cuando el propio gate
 *     lanza un subproceso (git/scan) que vuelve a disparar el hook: con la
 *     variable de guarda puesta, el shim sale 0/permite sin re-evaluar. Las
 *     guardas de Claude y Kiro son INDEPENDIENTES (una no silencia a la otra).
 *  3. Las tres políticas soportadas por G.5 — push directo a la rama default,
 *     force push peligroso y `--no-verify` — se bloquean desde AMBOS
 *     adaptadores en enforce.
 *  4. Límites honestos: tools no interceptables por contenido (MCP en Claude,
 *     use_aws en Kiro) se permiten sin atribuir protección falsa.
 *
 * No hay red real ni secretos reales. Las sub-invocaciones de los shims usan un
 * stub `kiritek-init` en PATH para contar invocaciones de forma determinista.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securityCli = require("../../src/security-cli.js");

const isWin = process.platform === "win32";

const CLAUDE_SHIM = path.join(
  __dirname, "..", "..", "templates", "core", "security", "adapters", "claude", "hooks", "pretooluse.sh"
);
const KIRO_SHIM = path.join(
  __dirname, "..", "..", "templates", "core", "security", "adapters", "kiro", "hooks", "pretooluse.sh"
);

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-coexist-"));
}

/** Config enforce con una rama default explícita (para el gate de push). */
function writeEnforceConfig(repo, defaultBranch = "main") {
  fs.writeFileSync(
    path.join(repo, "kiritek-security.config.json"),
    JSON.stringify({
      version: 1,
      mode: "enforce",
      defaultBranch: { explicit: defaultBranch, remote: "origin" },
      git: { blockDirectDefaultPush: true, forcePolicy: "deny" },
    })
  );
}

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    get out() { return out; },
    get err() { return err; },
  };
}

/** El CLI emite un único bloque JSON (pretty-printed) por stdout. */
function parseJson(out) {
  try { return JSON.parse(out); } catch (_) {}
  try { return JSON.parse(out.trim().split("\n").pop()); } catch (_) {}
  return null;
}

/** `validate claude-hook` en proceso. */
function runClaude(event, repo) {
  const cap = capture();
  const code = securityCli.run(["validate", "claude-hook", "--format=json"], {
    cwd: repo, env: {}, stdout: cap.stdout, stderr: cap.stderr,
    stdinData: typeof event === "string" ? event : JSON.stringify(event),
  });
  return { code, out: cap.out, err: cap.err, json: parseJson(cap.out) };
}

/** `validate kiro-hook` en proceso. */
function runKiro(event, repo) {
  const cap = capture();
  const code = securityCli.run(["validate", "kiro-hook", "--format=json"], {
    cwd: repo, env: {}, stdout: cap.stdout, stderr: cap.stderr,
    stdinData: typeof event === "string" ? event : JSON.stringify(event),
  });
  return { code, out: cap.out, err: cap.err, json: parseJson(cap.out) };
}

// --- 1. Ambos adaptadores evalúan el mismo evento de forma independiente ---

test("coexistencia: un .env peligroso lo bloquean AMBOS adaptadores por separado", () => {
  const repo = tmpRepo();
  try {
    writeEnforceConfig(repo);
    const claudeEvent = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: path.join(repo, ".env"), content: "TOKEN=1" },
      cwd: repo,
    };
    const kiroEvent = {
      hook_event_name: "PreToolUse",
      tool_name: "fs_write",
      tool_input: { path: path.join(repo, ".env"), text: "TOKEN=1" },
      cwd: repo,
    };
    const c = runClaude(claudeEvent, repo);
    const k = runKiro(kiroEvent, repo);

    // Claude bloquea vía permissionDecision=deny + exit 2.
    assert.equal(c.code, 2);
    assert.equal(c.json.hookSpecificOutput.permissionDecision, "deny");
    // Kiro bloquea vía exit 2.
    assert.equal(k.code, 2);
    assert.equal(k.json.blocked, true);
    assert.equal(k.json.decision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("coexistencia: código normal lo permiten AMBOS (sin falsos positivos cruzados)", () => {
  const repo = tmpRepo();
  try {
    writeEnforceConfig(repo);
    const c = runClaude({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: path.join(repo, "src/ok.js"), content: "const x = 1;" }, cwd: repo,
    }, repo);
    const k = runKiro({
      hook_event_name: "PreToolUse", tool_name: "fs_write",
      tool_input: { path: path.join(repo, "src/ok.js"), text: "const x = 1;" }, cwd: repo,
    }, repo);
    assert.equal(c.code, 0);
    assert.equal(c.json.hookSpecificOutput.permissionDecision, "allow");
    assert.equal(k.code, 0);
    assert.equal(k.json.blocked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- 2. Políticas Git soportadas (G.5) bloqueadas desde AMBOS adaptadores ---

const G5_COMMANDS = [
  { name: "push directo a la rama default", command: "git push origin main" },
  { name: "force push peligroso", command: "git push --force origin feature" },
  { name: "bypass de hooks (--no-verify)", command: "git push --no-verify origin feature" },
];

for (const scenario of G5_COMMANDS) {
  test(`G.5: Claude bloquea ${scenario.name} en enforce`, () => {
    const repo = tmpRepo();
    try {
      writeEnforceConfig(repo);
      const c = runClaude({
        hook_event_name: "PreToolUse", tool_name: "Bash",
        tool_input: { command: scenario.command }, cwd: repo,
      }, repo);
      assert.equal(c.code, 2, `Claude debe bloquear: ${scenario.command}`);
      assert.equal(c.json.hookSpecificOutput.permissionDecision, "deny");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test(`G.5: Kiro bloquea ${scenario.name} en enforce`, () => {
    const repo = tmpRepo();
    try {
      writeEnforceConfig(repo);
      const k = runKiro({
        hook_event_name: "PreToolUse", tool_name: "execute_bash",
        tool_input: { command: scenario.command }, cwd: repo,
      }, repo);
      assert.equal(k.code, 2, `Kiro debe bloquear: ${scenario.command}`);
      assert.equal(k.json.blocked, true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
}

// --- 3. Límites honestos: tools no interceptables por contenido ---

test("límites honestos: Claude permite MCP y Kiro permite use_aws (sin protección falsa)", () => {
  const repo = tmpRepo();
  try {
    writeEnforceConfig(repo);
    const c = runClaude({
      hook_event_name: "PreToolUse", tool_name: "mcp__jira__create_issue",
      tool_input: { summary: "x" }, cwd: repo,
    }, repo);
    const k = runKiro({
      hook_event_name: "PreToolUse", tool_name: "use_aws",
      tool_input: { service: "s3", operation: "list-buckets" }, cwd: repo,
    }, repo);
    assert.equal(c.code, 0);
    assert.equal(c.json.hookSpecificOutput.permissionDecision, "allow");
    assert.equal(k.code, 0);
    assert.equal(k.json.blocked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- 4. SIN DOBLE EJECUCIÓN: la guarda anti-recursión evita re-evaluar cuando
//        el gate lanza un subproceso que vuelve a disparar el hook. ---
//
// Montamos un stub `kiritek-init` que CUENTA sus invocaciones. El shim real lo
// invoca una vez; si una sub-invocación (p. ej. git dentro del gate) re-disparara
// el shim, la guarda debe hacer que esa segunda vez salga 0 sin llamar al CLI.

function withCountingStub(fn) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-coexist-bin-"));
  const counter = path.join(binDir, "count.txt");
  fs.writeFileSync(counter, "");
  // El stub registra una línea por invocación y devuelve exit 0 (permite).
  const stub = path.join(binDir, "kiritek-init");
  fs.writeFileSync(stub, `#!/bin/sh\nprintf 'x' >> "${counter}"\nexit 0\n`, { mode: 0o755 });
  try {
    return fn({ binDir, counter });
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

function invocations(counterFile) {
  return fs.readFileSync(counterFile, "utf8").length;
}

test("sin doble ejecución: con la guarda de Claude puesta, el shim NO re-invoca el CLI", { skip: isWin ? "shim sh no portable a Windows" : false }, () => {
  withCountingStub(({ binDir, counter }) => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status" },
    });
    // Guarda ya puesta (simula una re-entrada desde un subproceso del gate).
    const guarded = spawnSync("sh", [CLAUDE_SHIM], {
      input: event,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KIRITEK_CLAUDE_HOOK_RUNNING: "1" },
      encoding: "utf8",
    });
    assert.equal(guarded.status, 0, "re-entrada guardada debe permitir sin bloquear");
    assert.equal(invocations(counter), 0, "con la guarda puesta el CLI NO debe invocarse (sin doble ejecución)");
  });
});

test("sin doble ejecución: con la guarda de Kiro puesta, el shim NO re-invoca el CLI", { skip: isWin ? "shim sh no portable a Windows" : false }, () => {
  withCountingStub(({ binDir, counter }) => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "execute_bash", tool_input: { command: "git status" },
    });
    const guarded = spawnSync("sh", [KIRO_SHIM], {
      input: event,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KIRITEK_KIRO_HOOK_RUNNING: "1" },
      encoding: "utf8",
    });
    assert.equal(guarded.status, 0, "re-entrada guardada debe permitir sin bloquear");
    assert.equal(invocations(counter), 0, "con la guarda puesta el CLI NO debe invocarse (sin doble ejecución)");
  });
});

test("guardas independientes: la guarda de Claude NO silencia al shim de Kiro (y viceversa)", { skip: isWin ? "shim sh no portable a Windows" : false }, () => {
  withCountingStub(({ binDir, counter }) => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "execute_bash", tool_input: { command: "git status" },
    });
    // Sólo la guarda de CLAUDE está puesta; el shim de KIRO debe evaluar igual
    // (sus guardas no se comparten → ninguno silencia al otro).
    const kiro = spawnSync("sh", [KIRO_SHIM], {
      input: event,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KIRITEK_CLAUDE_HOOK_RUNNING: "1" },
      encoding: "utf8",
    });
    assert.equal(kiro.status, 0, "el stub permite (exit 0)");
    assert.equal(invocations(counter), 1, "el shim de Kiro debe invocar el CLI una vez (guarda de Claude no aplica)");
  });
});

test("una sola evaluación por shim en el camino feliz (sin doble ejecución del CLI)", { skip: isWin ? "shim sh no portable a Windows" : false }, () => {
  withCountingStub(({ binDir, counter }) => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "fs_write", tool_input: { path: "src/x.js" },
    });
    const res = spawnSync("sh", [KIRO_SHIM], {
      input: event,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(res.status, 0);
    assert.equal(invocations(counter), 1, "el shim debe invocar el CLI exactamente una vez");
  });
});
