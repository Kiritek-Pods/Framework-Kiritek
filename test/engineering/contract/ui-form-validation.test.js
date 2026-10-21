"use strict";

// T16.1: suite de conformidad R27 de `ui.form-validation` (positivos, negativos y bordes),
// ejecutada con el pipeline real en warn, dos veces por caso.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runConformance, suiteFor } = require("../../../src/engineering/guardrails/conformance/index.js");
const { builtinControls } = require("../../../src/engineering/guardrails/controls/index.js");

const CONTROL = "ui.form-validation";

test("T16.1 ui.form-validation: la suite R27 pasa completa y reproducible", async () => {
  const r = await runConformance(CONTROL);
  assert.equal(r.ref, `${suiteFor(CONTROL).id}@${suiteFor(CONTROL).version}`);
  assert.deepEqual(r.cases.filter((c) => !c.passed).map((c) => `${c.id}: ${c.failures.join("; ")}`), []);
  assert.equal(r.passed, true);
  const kinds = r.cases.reduce((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] || 0) + 1 }), {});
  assert.ok(kinds.positive >= 1 && kinds.negative >= 1 && kinds.edge >= 1, JSON.stringify(kinds));
  for (const c of r.cases) {
    // Positivos nunca son elegibles; negativos siempre; bordes según su caso
    // (heurísticas, timeouts y conflictos nunca — lo verifica el runner).
    if (c.kind === "negative") assert.equal(c.eligible, true, `${c.id}: un fallo determinista debe ser elegible tras promoción`);
    if (c.kind === "positive") assert.equal(c.eligible, false, `${c.id}: un positivo nunca es elegible`);
  }
});

test("T16.1 ui.form-validation: la suite detecta una implementación que no reporta fallos", async () => {
  const controls = builtinControls();
  const blind = { ...controls, [CONTROL]: { ...controls[CONTROL], evaluator: { version: "9.9.9", evaluate: () => ({ decision: "allow" }) } } };
  const r = await runConformance(CONTROL, { controls: blind });
  assert.equal(r.passed, false);
  assert.ok(r.cases.filter((c) => c.kind === "negative").every((c) => !c.passed), "todos los negativos deben fallar");
});
