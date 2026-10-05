"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluatePushGuards } = require("../../src/git/push-guards.js");

const A = "a".repeat(40);
const B = "b".repeat(40);
const Z = "0".repeat(40);
const CFG = { defaultBranch: { explicit: "main" }, git: { blockDirectDefaultPush: true, forcePolicy: "deny" } };
const ff = () => true;
const nonFf = () => false;

function run(stdin, { mode = "enforce", config = CFG, isAncestor = ff } = {}) {
  return evaluatePushGuards({ repoRoot: "/repo", stdin, mode, config, isAncestor });
}

test("push directo a la rama default → deny en enforce, warn en warning", () => {
  const line = `refs/heads/main ${A} refs/heads/main ${B}\n`;
  const e = run(line);
  assert.equal(e.decision, "deny");
  assert.equal(e.findings[0].ruleId, "direct-push-default");
  assert.equal(run(line, { mode: "warning" }).decision, "warn");
});

test("crear la rama default (primer push) se permite", () => {
  assert.equal(run(`refs/heads/main ${A} refs/heads/main ${Z}\n`).decision, "allow");
});

test("borrar la rama default → deny", () => {
  const r = run(`(delete) ${Z} refs/heads/main ${B}\n`);
  assert.equal(r.findings[0].ruleId, "delete-default-branch");
});

test("feature branch fast-forward → allow; no fast-forward → force-push deny", () => {
  const line = `refs/heads/feat/x ${A} refs/heads/feat/x ${B}\n`;
  assert.equal(run(line).decision, "allow");
  const r = run(line, { isAncestor: nonFf });
  assert.equal(r.decision, "deny");
  assert.equal(r.findings[0].ruleId, "force-push");
});

test("forcePolicy lease-only: no fast-forward sólo advierte; allow no revisa", () => {
  const line = `refs/heads/feat/x ${A} refs/heads/feat/x ${B}\n`;
  const lease = run(line, { isAncestor: nonFf, config: { ...CFG, git: { forcePolicy: "lease-only" } } });
  assert.equal(lease.decision, "warn");
  const allow = run(line, { isAncestor: nonFf, config: { ...CFG, git: { forcePolicy: "allow" } } });
  assert.equal(allow.decision, "allow");
});

test("blockDirectDefaultPush=false permite push a default", () => {
  const r = run(`refs/heads/main ${A} refs/heads/main ${B}\n`, { config: { ...CFG, git: { blockDirectDefaultPush: false, forcePolicy: "deny" } } });
  assert.equal(r.decision, "allow");
});

test("tags no se tratan como ramas", () => {
  assert.equal(run(`refs/tags/v1 ${A} refs/tags/v1 ${B}\n`, { isAncestor: nonFf }).decision, "allow");
});
