"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securityCli = require("../../src/security-cli.js");

// Secreto SINTÉTICO para pruebas de redacción (patrón AKIA...); no es real.
const SYNTHETIC_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

const SHIM = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "core",
  "security",
  "adapters",
  "kiro",
  "hooks",
  "pretooluse.sh"
);

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-kiro-"));
}

/**
 * Ejecuta `validate kiro-hook` inyectando el evento por `stdinData`.
 * Devuelve exit code, stdout crudo, stderr y el JSON parseado de stdout.
 */
function runHook(event, { cwd, mode } = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  const argv = ["validate", "kiro-hook", "--format=json"];
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
    try {
      json = JSON.parse(out.trim().split("\n").pop());
    } catch (_) {
      json = null;
    }
  }
  return { code, out, err, json };
}

test("kiro-hook: fs_write a .env (enforce) → exit 2 (bloquea)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "fs_write",
        tool_input: { path: path.join(repo, ".env"), text: "SECRET=1" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.equal(r.json.blocked, true);
    assert.equal(r.json.decision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook: fs_write de código normal (enforce) → exit 0 (permite)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "fs_write",
        tool_input: { path: path.join(repo, "src/x.js"), text: "const x = 1;" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 0);
    assert.equal(r.json.blocked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook: execute_bash git push --no-verify → exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "execute_bash",
        tool_input: { command: "git push --no-verify origin feature" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.equal(r.json.blocked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook FAIL-SAFE: stdin vacío → exit 2 (nunca permite)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook("", { cwd: repo, mode: "enforce" });
    assert.equal(r.code, 2);
    assert.equal(r.json.blocked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook FAIL-SAFE: JSON inválido (payload malformado) → exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook("{ no es json", { cwd: repo, mode: "enforce" });
    assert.equal(r.code, 2);
    assert.equal(r.json.blocked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook FAIL-SAFE: evento equivocado (PostToolUse) → exit 2", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      { hook_event_name: "PostToolUse", tool_name: "execute_bash", tool_input: { command: "ls" } },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.equal(r.json.blocked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook: la salida de deny no filtra el secreto sintético (stdout ni stderr)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "fs_write",
        tool_input: { path: path.join(repo, ".env.example"), text: `AWS=${SYNTHETIC_AWS_KEY}` },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 2);
    assert.ok(!r.out.includes(SYNTHETIC_AWS_KEY), "stdout no debe filtrar el secreto");
    assert.ok(!r.err.includes(SYNTHETIC_AWS_KEY), "stderr no debe filtrar el secreto");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiro-hook: use_aws → exit 0 (no interceptable por contenido; Git/CI cubren)", () => {
  const repo = tmpRepo();
  try {
    const r = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "use_aws",
        tool_input: { service: "s3", operation: "list-buckets" },
        cwd: repo,
      },
      { cwd: repo, mode: "enforce" }
    );
    assert.equal(r.code, 0);
    assert.equal(r.json.blocked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- auditoría / coexistencia con Claude ---

test("kiro-hook: adaptador Kiro aparece en la auditoría de capacidades", () => {
  const repo = tmpRepo();
  try {
    const cap = require("../../src/audit/capabilities.js");
    const audit = cap.runCapabilityAudit(repo);
    const kiroCap = audit.capabilities.find((c) => c.id === "assistant-kiro");
    assert.ok(kiroCap, "debe existir la capacidad assistant-kiro");
    assert.equal(kiroCap.installed, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("coexistencia: Claude y Kiro aparecen por separado en la auditoría (sin duplicar)", () => {
  const repo = tmpRepo();
  try {
    const cap = require("../../src/audit/capabilities.js");
    const audit = cap.runCapabilityAudit(repo);
    const ids = audit.capabilities.map((c) => c.id);
    assert.ok(ids.includes("assistant-claude"));
    assert.ok(ids.includes("assistant-kiro"));
    // Cada adaptador aparece exactamente una vez (sin doble registro).
    assert.equal(ids.filter((i) => i === "assistant-kiro").length, 1);
    assert.equal(ids.filter((i) => i === "assistant-claude").length, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- shim: semántica de exit code de Kiro ---
// (0 permite, 2 bloquea, cualquier OTRO código del core = fallo NO bloqueante
//  que el shim convierte deliberadamente a exit 2.)

function runShim(stdinData, { stubExit, pathPrepend } = {}) {
  // Un stub `kiritek-init` en PATH que devuelve el exit code deseado permite
  // ejercitar la semántica del shim sin depender del CLI real.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-stub-"));
  if (stubExit !== undefined) {
    const stub = path.join(binDir, "kiritek-init");
    fs.writeFileSync(stub, `#!/bin/sh\nexit ${stubExit}\n`, { mode: 0o755 });
  }
  const env = { ...process.env };
  if (stubExit !== undefined) {
    env.PATH = `${binDir}:${env.PATH}`;
  } else if (pathPrepend === "empty") {
    // PATH con utilidades estándar (sh, mktemp, cat, rm) pero SIN kiritek-init,
    // para probar el fail-safe "CLI ausente" sin romper el propio shim.
    env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  }
  const res = spawnSync("sh", [SHIM], { input: stdinData, env, encoding: "utf8" });
  fs.rmSync(binDir, { recursive: true, force: true });
  return res;
}

test("shim: core devuelve exit 0 → shim exit 0 (permite)", () => {
  const res = runShim(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "fs_write", tool_input: { path: "x.js" } }),
    { stubExit: 0 }
  );
  assert.equal(res.status, 0);
});

test("shim: core devuelve exit 2 → shim exit 2 (bloquea)", () => {
  const res = runShim(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "fs_write", tool_input: { path: ".env" } }),
    { stubExit: 2 }
  );
  assert.equal(res.status, 2);
});

test("shim: código inesperado del core (p. ej. 1) → shim exit 2 (bloqueo deliberado)", () => {
  // Kiro trataría un código distinto de 2 como fallo NO bloqueante; el shim lo
  // normaliza a exit 2 para garantizar el bloqueo (fail-safe).
  const res = runShim(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "fs_write", tool_input: { path: ".env" } }),
    { stubExit: 1 }
  );
  assert.equal(res.status, 2);
});

test("shim: CLI ausente → exit 2 (fail-safe, nunca permite)", () => {
  const res = runShim(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "fs_write", tool_input: { path: ".env" } }),
    { pathPrepend: "empty" }
  );
  assert.equal(res.status, 2);
});

test("shim: guard anti-recursión → exit 0 cuando ya está corriendo", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-stub-"));
  try {
    const env = { ...process.env, KIRITEK_KIRO_HOOK_RUNNING: "1" };
    const res = spawnSync("sh", [SHIM], { input: "{}", env, encoding: "utf8" });
    assert.equal(res.status, 0);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
