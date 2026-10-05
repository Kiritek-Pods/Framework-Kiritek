"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const assistants = require("../../src/install/assistants.js");
const checks = require("../../src/audit/checks.js");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-assist-"));
}

test("Claude: enlaza sin tocar hooks del usuario, es idempotente y desenlaza sólo lo suyo", () => {
  const repo = tmp();
  try {
    const userHook = { matcher: "Bash", hooks: [{ type: "command", command: "./mi-hook.sh" }] };
    fs.mkdirSync(path.join(repo, ".claude"));
    fs.writeFileSync(
      path.join(repo, ".claude", "settings.json"),
      JSON.stringify({ model: "x", hooks: { PreToolUse: [userHook] } })
    );
    assert.equal(assistants.linkClaude(repo).status, "linked");
    assistants.linkClaude(repo); // idempotente
    let s = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
    assert.equal(s.model, "x");
    assert.deepEqual(s.hooks.PreToolUse[0], userHook);
    assert.equal(s.hooks.PreToolUse.length, 4, "1 del usuario + 3 de Kiritek, sin duplicar");
    assert.equal(checks.claudeLinkage(repo).linked, true);

    assistants.unlinkClaude(repo);
    s = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(s, { model: "x", hooks: { PreToolUse: [userHook] } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Claude: settings.json inválido no se toca (conflict)", () => {
  const repo = tmp();
  try {
    fs.mkdirSync(path.join(repo, ".claude"));
    fs.writeFileSync(path.join(repo, ".claude", "settings.json"), "{ no es json");
    assert.equal(assistants.linkClaude(repo).status, "conflict");
    assert.equal(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"), "{ no es json");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Claude: si Kiritek creó settings.json, desenlazar lo borra", () => {
  const repo = tmp();
  try {
    assistants.linkClaude(repo);
    assistants.unlinkClaude(repo);
    assert.equal(fs.existsSync(path.join(repo, ".claude", "settings.json")), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Kiro: enlaza hooks v1 reconocidos por la auditoría y no pisa archivos ajenos", () => {
  const repo = tmp();
  try {
    assert.equal(assistants.linkKiro(repo).status, "linked");
    assert.equal(checks.kiroLinkage(repo).linked, true);
    assistants.unlinkKiro(repo);
    assert.equal(checks.kiroLinkage(repo).linked, false);

    assert.equal(fs.existsSync(path.join(repo, ".kiro")), false, "desenlazar limpia directorios vacíos");
    fs.mkdirSync(path.join(repo, ".kiro", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".kiro", "hooks", "kiritek-security-write.json"), '{"version":"v1","hooks":[]}');
    assert.equal(assistants.linkKiro(repo).status, "conflict");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("cliInPath: detecta kiritek-init ejecutable en el PATH", () => {
  const dir = tmp();
  try {
    assert.equal(assistants.cliInPath({ PATH: dir }), false);
    fs.writeFileSync(path.join(dir, "kiritek-init"), "#!/bin/sh\n", { mode: 0o755 });
    if (process.platform !== "win32") assert.equal(assistants.cliInPath({ PATH: dir }), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
