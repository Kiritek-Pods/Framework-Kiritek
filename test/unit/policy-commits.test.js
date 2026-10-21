"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const commits = require("../../src/policy/commits.js");

const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "commits", "messages.json"), "utf8")
);

// Config con Jira deshabilitado (default) y Jira habilitado.
const CFG_JIRA_OFF = { mode: "enforce", config: { mode: "enforce" } };
function withJira(enabled, extra = {}) {
  return {
    mode: "enforce",
    config: { mode: "enforce", jira: { enabled, keyPattern: "[A-Z][A-Z0-9]+-[0-9]+", locations: ["commit", "branch", "pr"], noJira: { token: "NO-JIRA", allowedTypes: ["chore", "docs", "ci"], requireReason: true }, ...extra } },
  };
}

// --- 22.1 Conventional Commits: tabla válidos/inválidos ---

test("válidos: todos pasan como allow (Jira off)", () => {
  for (const c of FIXTURES.valid) {
    const res = commits.evaluateCommit({ message: c.message, ...CFG_JIRA_OFF });
    assert.equal(res.decision, "allow", `${c.name} debería ser allow: ${res.reason || ""}`);
  }
});

test("inválidos: todos deniegan en enforce con la regla esperada", () => {
  for (const c of FIXTURES.invalid) {
    const res = commits.evaluateCommit({ message: c.message, ...CFG_JIRA_OFF });
    assert.equal(res.decision, "deny", `${c.name} debería denegar`);
    assert.ok(res.reason && res.reason.length > 0, `${c.name} debe tener razón`);
  }
});

test("warning degrada deny a warn", () => {
  const res = commits.evaluateCommit({ message: "wip: nope", mode: "warning", config: { mode: "warning" } });
  assert.equal(res.decision, "warn");
});

// --- breaking changes ---

test("breaking: detecta ! y footer BREAKING CHANGE", () => {
  for (const c of FIXTURES.breaking) {
    const res = commits.evaluateCommit({ message: c.message, ...CFG_JIRA_OFF });
    assert.equal(res.meta.breaking, c.breaking, `${c.name}`);
    assert.equal(res.decision, "allow");
  }
});

// --- 22.3 merge/revert automáticos ---

test("automáticos: merge/revert permitidos pasan sin Conventional Commits", () => {
  for (const c of FIXTURES.automatic) {
    const res = commits.evaluateCommit({ message: c.message, ...CFG_JIRA_OFF });
    assert.equal(res.meta.automatic, c.kind, c.name);
    assert.equal(res.decision, "allow", c.name);
  }
});

test("automáticos: merge/revert pueden bloquearse por política explícita", () => {
  const cfg = { mode: "enforce", config: { mode: "enforce", commits: { allowMergeCommits: false, allowRevertCommits: false } } };
  const merge = commits.evaluateCommit({ message: "Merge branch 'x' into main", ...cfg });
  assert.equal(merge.decision, "deny");
  const revert = commits.evaluateCommit({ message: "Revert \"feat: y\"", ...cfg });
  assert.equal(revert.decision, "deny");
});

// --- 22.3 Jira on/off ---

test("Jira off: NO exige clave y NO desactiva Conventional Commits", () => {
  const ok = commits.evaluateCommit({ message: FIXTURES.jira.withoutKey, ...CFG_JIRA_OFF });
  assert.equal(ok.decision, "allow");
  assert.equal(ok.meta.jira.required, false);
  // Conventional Commits sigue activo aunque Jira esté off.
  const bad = commits.evaluateCommit({ message: "nope sin tipo", ...CFG_JIRA_OFF });
  assert.equal(bad.decision, "deny");
});

test("Jira on: con clave en commit → allow; sin clave → deny", () => {
  const on = withJira(true);
  const withKey = commits.evaluateCommit({ message: FIXTURES.jira.withKeyInCommit, ...on });
  assert.equal(withKey.decision, "allow");
  assert.ok(withKey.meta.jira.keys.includes("PROJ-1234"));

  const without = commits.evaluateCommit({ message: FIXTURES.jira.withoutKey, ...on });
  assert.equal(without.decision, "deny");
  assert.equal(without.meta.jira.satisfied, false);
});

test("Jira on: clave extraída desde la rama", () => {
  const on = withJira(true);
  const res = commits.evaluateCommit({
    message: FIXTURES.jira.withKeyInBranch,
    branch: FIXTURES.jira.branchWithKey,
    ...on,
  });
  assert.equal(res.decision, "allow");
  assert.ok(res.meta.jira.byLocation.branch);
});

// --- patrón custom ---

test("Jira on: patrón custom reconoce claves no estándar", () => {
  const on = withJira(true, { keyPattern: FIXTURES.jira.customPattern });
  const res = commits.evaluateCommit({ message: FIXTURES.jira.customKeyMessage, ...on });
  assert.equal(res.decision, "allow");
  assert.ok(res.meta.jira.keys.includes("TASK_9001"));
});

// --- 22.4 validación sintáctica, nunca existencia remota ---

test("etiqueta: validación sintáctica y verificación remota unverified", () => {
  const res = commits.evaluateCommit({ message: FIXTURES.jira.withKeyInCommit, ...withJira(true) });
  assert.equal(res.meta.validation, "syntactic");
  assert.equal(res.meta.remoteVerification, "unverified");
});

// --- 22.3 NO-JIRA autorizado / no autorizado ---

test("NO-JIRA autorizado para tipo permitido con razón", () => {
  const res = commits.evaluateCommit({ message: FIXTURES.noJira.authorizedChore, ...withJira(true) });
  assert.equal(res.decision, "allow");
  assert.equal(res.meta.jira.noJira.authorized, true);
});

test("NO-JIRA no autorizado para tipo no permitido (feat)", () => {
  const res = commits.evaluateCommit({ message: FIXTURES.noJira.unauthorizedFeat, ...withJira(true) });
  assert.equal(res.decision, "deny");
  assert.equal(res.meta.jira.noJira.authorized, false);
});

test("NO-JIRA sin razón se rechaza cuando requireReason", () => {
  const res = commits.evaluateCommit({ message: FIXTURES.noJira.missingReason, ...withJira(true) });
  assert.equal(res.decision, "deny");
});

test("NO-JIRA no es bypass universal: allowedTypes vacío nunca autoriza", () => {
  const on = withJira(true, { noJira: { token: "NO-JIRA", allowedTypes: [], requireReason: true } });
  const res = commits.evaluateCommit({ message: FIXTURES.noJira.authorizedChore, ...on });
  assert.equal(res.decision, "deny");
});

// --- patrón Jira inválido ---

test("patrón Jira inválido se reporta como error de configuración", () => {
  const on = withJira(true, { keyPattern: "[A-Z(" });
  const res = commits.evaluateCommit({ message: FIXTURES.jira.withKeyInCommit, ...on });
  assert.equal(res.decision, "deny");
  assert.match(res.reason, /keyPattern/);
});

// --- commits deshabilitados ---

test("commits.enabled=false omite Conventional Commits pero no la clave Jira", () => {
  const cfg = { mode: "enforce", config: { mode: "enforce", commits: { enabled: false }, jira: { enabled: true, keyPattern: "[A-Z][A-Z0-9]+-[0-9]+", locations: ["commit"] } } };
  const res = commits.evaluateCommit({ message: "texto libre sin formato PROJ-1", ...cfg });
  // No hay violación de formato; la clave Jira está presente → allow.
  assert.equal(res.decision, "allow");
});
