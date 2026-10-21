"use strict";

// Helpers de los controles con contrato + harness (T18–T21): corre el harness
// con un adapter de fixture y evalúa la traza con el evaluator real.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONTROLS = path.join(__dirname, "..", "..", "..", "src", "engineering", "guardrails", "controls");
const FIXTURES = path.join(__dirname, "..", "fixtures");

/** Carga un fixture `.adapter.js.fixture` como módulo (copia temporal). */
function loadFixture(dir, name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-adapter-"));
  const file = path.join(tmp, `${name}.adapter.js`);
  fs.copyFileSync(path.join(FIXTURES, dir, `${name}.adapter.js.fixture`), file);
  const mod = require(file);
  fs.rmSync(tmp, { recursive: true, force: true });
  return mod;
}

/**
 * @param {object} spec  { slug, factory, contractKind, behaviorKind, fixtures, param }
 * @param {string} adapter  nombre del fixture
 * @param {object} contractFacts  hechos del contrato (como los produce contract.js)
 * @param {object} [opts]  { params, harnessParams, now, event }
 */
async function runControl(spec, adapter, contractFacts, opts = {}) {
  const { runSuite } = require(path.join(CONTROLS, spec.slug, "harness.js"));
  const evaluator = require(path.join(CONTROLS, spec.slug, "evaluator.js"));
  const hp = opts.harnessParams || spec.harnessParams(contractFacts);
  const trace = await runSuite(loadFixture(spec.fixtures, adapter)[spec.factory], hp);
  const observations = [
    { kind: spec.contractKind, observationId: "obs/contract", facts: { declared: true, valid: true, errorCodes: [], contract: contractFacts } },
    ...trace.scenarios.filter((s) => s.status === "ok").map((s) => ({ kind: spec.behaviorKind, observationId: `obs/${s.id}`, facts: { scenario: s.id, params: hp, steps: s.steps } })),
  ];
  const result = evaluator.evaluate({ effectiveConfig: { [spec.param]: "apps/x/contract.json", ...(opts.params || {}) }, observations, unit: { id: "acme/x", root: "apps/x" }, event: opts.event || "pr", clockRef: opts.now || "2026-10-05T12:00:00.000Z" });
  const rules = [...new Set((result.findings || []).map((f) => f.ruleId.split("/").pop()))].sort();
  return { trace, result, rules };
}

/** Evalúa sólo con observaciones dadas (sin harness). */
function evaluateWith(spec, observations, { params = {}, now = "2026-10-05T12:00:00.000Z", event = "pr" } = {}) {
  const evaluator = require(path.join(CONTROLS, spec.slug, "evaluator.js"));
  return evaluator.evaluate({ effectiveConfig: { [spec.param]: "apps/x/contract.json", ...params }, observations, unit: { id: "acme/x", root: "apps/x" }, event, clockRef: now });
}

module.exports = { loadFixture, runControl, evaluateWith, CONTROLS, FIXTURES };
