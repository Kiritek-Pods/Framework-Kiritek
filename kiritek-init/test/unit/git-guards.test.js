"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../../src/git/default-branch.js");
const guard = require("../../src/policy/git.js");

// --- default-branch (sin repo real: se inyectan candidatos vía explicit/provider) ---

test("resolveDefaultBranch: explícito gana y valida formato", () => {
  const r = db.resolveDefaultBranch({ repoRoot: "/x", explicit: "develop" });
  assert.equal(r.branch, "develop");
  assert.equal(r.source, "explicit");
});

test("resolveDefaultBranch: explícito inválido lanza", () => {
  assert.throws(() => db.resolveDefaultBranch({ repoRoot: "/x", explicit: "mala rama!" }), /inválida/);
});

test("resolveDefaultBranch: provider único resuelve sin asumir main", () => {
  const r = db.resolveDefaultBranch({ repoRoot: "/x", providerLookup: () => "trunk" });
  assert.equal(r.branch, "trunk");
  assert.equal(r.ambiguous, false);
});

test("resolveDefaultBranch: sin fuentes → ambiguo, no asume main", () => {
  const r = db.resolveDefaultBranch({ repoRoot: "/x", providerLookup: () => null });
  assert.equal(r.branch, null);
  assert.equal(r.ambiguous, true);
  assert.equal(r.source, "none");
});

test("validBranchName: acepta nombres válidos y rechaza raros", () => {
  for (const ok of ["main", "master", "trunk", "develop", "release/1.2", "feature/ABC-1"]) {
    assert.equal(db.validBranchName(ok), true, ok);
  }
  for (const bad of ["", "a b", "x~1", "y^2", "z:w"]) {
    assert.equal(db.validBranchName(bad), false, bad);
  }
});

// --- guardas de comandos ---

test("guard: push directo a la rama default (enforce) → deny", () => {
  const res = guard.evaluateGitCommand({
    args: ["push", "origin", "main"],
    mode: "enforce",
    defaultBranch: "main",
  });
  assert.equal(res.decision, "deny");
  assert.match(res.reason, /push directo a la rama default/);
});

test("guard: push a rama default no estándar también se bloquea", () => {
  const res = guard.evaluateGitCommand({
    args: ["push", "origin", "trunk"],
    mode: "enforce",
    defaultBranch: "trunk",
  });
  assert.equal(res.decision, "deny");
});

test("guard: --force es force push peligroso → deny", () => {
  const res = guard.evaluateGitCommand({ args: ["push", "--force", "origin", "feat"], mode: "enforce", defaultBranch: "main" });
  assert.equal(res.decision, "deny");
  assert.match(res.reason, /force push peligroso/);
});

test("guard: +refspec cuenta como force", () => {
  const res = guard.evaluateGitCommand({ args: ["push", "origin", "+feat:feat"], mode: "enforce", defaultBranch: "main" });
  assert.equal(res.decision, "deny");
});

test("guard: --force-with-lease depende de forcePolicy", () => {
  const deny = guard.evaluateGitCommand({ args: ["push", "--force-with-lease", "origin", "feat"], mode: "enforce", defaultBranch: "main", forcePolicy: "deny" });
  assert.equal(deny.decision, "deny");
  const allow = guard.evaluateGitCommand({ args: ["push", "--force-with-lease", "origin", "feat"], mode: "enforce", defaultBranch: "main", forcePolicy: "lease-only" });
  assert.equal(allow.decision, "allow");
});

test("guard: --no-verify siempre se bloquea, incluso con break-glass", () => {
  const res = guard.evaluateGitCommand({ args: ["commit", "--no-verify"], mode: "enforce", defaultBranch: "main" });
  assert.equal(res.decision, "deny");
  const bg = guard.evaluateGitCommand({ args: ["commit", "--no-verify"], mode: "enforce", defaultBranch: "main", breakGlass: true });
  assert.equal(bg.decision, "deny"); // break-glass NO levanta --no-verify
});

test("guard: break-glass levanta push directo/force pero no no-verify", () => {
  const res = guard.evaluateGitCommand({
    args: ["push", "--force", "origin", "main"],
    mode: "enforce",
    defaultBranch: "main",
    breakGlass: true,
  });
  assert.equal(res.decision, "allow"); // force + directo levantados por break-glass
});

test("guard: comando inofensivo → allow", () => {
  const res = guard.evaluateGitCommand({ args: ["push", "origin", "feature/x"], mode: "enforce", defaultBranch: "main" });
  assert.equal(res.decision, "allow");
});

test("guard: warning degrada a warn en vez de deny", () => {
  const res = guard.evaluateGitCommand({ args: ["push", "origin", "main"], mode: "warning", defaultBranch: "main" });
  assert.equal(res.decision, "warn");
});
