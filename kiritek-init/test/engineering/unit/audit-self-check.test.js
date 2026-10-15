"use strict";

// T15.3: los self-checks detectan implementaciones que no cumplen el contrato.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runSelfChecks } = require("../../../src/engineering/guardrails/audit/self-check.js");
const { builtinControls } = require("../../../src/engineering/guardrails/controls/index.js");

test("T15.3 self-checks pasan con los controles builtin", () => {
  const r = runSelfChecks(builtinControls());
  assert.equal(r.passed, true, JSON.stringify(r.checks.filter((c) => !c.passed)));
  // Dos checks por control builtin + el canario de redacción.
  assert.equal(r.checks.length, Object.keys(builtinControls()).length * 2 + 1);
});

test("T15.3 un evaluator que no detecta el fallo determinista o que eleva heurísticas falla el self-check", () => {
  const controls = builtinControls();
  const blind = { ...controls, "app.minimum-supported-version": { ...controls["app.minimum-supported-version"], evaluator: { version: "9.9.9", evaluate: () => ({ decision: "allow" }) } } };
  const r1 = runSelfChecks(blind);
  assert.equal(r1.passed, false);
  assert.deepEqual(r1.checks.filter((c) => !c.passed).map((c) => `${c.controlId}:${c.id}`), ["app.minimum-supported-version:deterministic-eligible", "app.minimum-supported-version:heuristic-never-blocks"]);
  const missing = { ...controls };
  delete missing["web.module-announcement"];
  assert.ok(runSelfChecks(missing).checks.some((c) => c.controlId === "web.module-announcement" && c.id === "implementation" && !c.passed));
});
