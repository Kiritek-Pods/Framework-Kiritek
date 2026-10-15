"use strict";

/**
 * Runner de conformidad R27 (T16.1, T16.4, T16.5). Cada caso se evalúa con el
 * pipeline REAL (config → catálogo builtin → collectors/harness → evaluator →
 * compuerta) en un repo temporal, en `warn`, DOS veces:
 *
 *  - decisión y reglas esperadas (positivos, negativos y bordes);
 *  - reproducible: mismos fingerprints en ambas corridas;
 *  - atribuible: todo finding apunta dentro de la unidad del caso;
 *  - elegibilidad: con el mismo resultado en `enforce` + momento PR, el
 *    predicado del core permite bloquear sólo los negativos deterministas;
 *    heurísticas, timeouts, conflictos y errores nunca.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCatalogSession } = require("../catalog/resolve.js");
const { resolveEngineeringConfig } = require("../config/index.js");
const { resolveUnits } = require("../workspace/units.js");
const { scopeHashFor } = require("../workspace/scope.js");
const { evaluateRun } = require("../orchestrator.js");
const { builtinControls } = require("../controls/index.js");
const { draftViolations } = require("../pipeline/aggregate.js");
const { SUITES, suiteFor, suiteRef } = require("./registry.js");
const { BUILTIN_ROOT } = require("../catalog/registry.js");

// Candidatos de catálogo del repo (antes del gate de release no están en catalogs/).
const CANDIDATES_ROOT = path.join(__dirname, "..", "..", "..", "..", "release", "candidates", "engineering", "guardrails");

/**
 * Sesión de catálogo para la versión de la suite. Para versiones con
 * `enforce` se pasan TODAS las suites registradas sólo para poder cargar el
 * catálogo: los casos corren en `warn` y la elegibilidad se simula aparte, así
 * que esto no aprueba nada (la aprobación real es approved.json).
 */
function sessionFor(version) {
  if (version === "1.0.0") return createCatalogSession({});
  const root = [BUILTIN_ROOT, CANDIDATES_ROOT].find((r) => fs.existsSync(path.join(r, version, "catalog.json")));
  return createCatalogSession({ roots: [root || BUILTIN_ROOT], approvedConformanceSuites: Object.values(SUITES).map(suiteRef) });
}

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const BASE = "89abcdef0123456789abcdef0123456789abcdef";
const NOW = "2026-10-05T12:00:00.000Z";
const UNIT = "conformance/unit";

function loadCases(slug) {
  return require(`./cases/${slug}.js`);
}

function writeRepo(slug, c) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-conf-")));
  const refDir = path.join(__dirname, "reference", slug);
  fs.mkdirSync(path.join(repo, "apps", "x"), { recursive: true });
  for (const f of fs.readdirSync(refDir)) fs.copyFileSync(path.join(refDir, f), path.join(repo, "apps", "x", f));
  for (const [rel, content] of Object.entries(c.files || {})) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
  return repo;
}

async function evaluateCase(suite, c, controls) {
  const repo = writeRepo(suite.slug, c);
  try {
    const document = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog: suite.catalog || "1.0.0" },
      workspace: { units: [{ id: UNIT, root: "apps/x", kind: "application", profiles: suite.profiles.map((id) => ({ id, version: "1.0.0" })), owns: ["apps/x/**"], controls: { [suite.control]: { level: "warn", parameters: c.parameters || {} } } }] },
    };
    const session = sessionFor(suite.catalog || "1.0.0");
    const resolvedConfig = resolveEngineeringConfig({ document, env: {}, repoRoot: repo, catalogSession: session });
    const resolvedUnits = resolveUnits(resolvedConfig, session.snapshot, { repoRoot: repo });
    const unitScope = { unitId: UNIT, coverage: "direct", reasons: ["owns:apps/x/**"], paths: c.paths || ["apps/x/src/index.ts"] };
    const scope = { moment: "pr", revision: HEAD, baseRevision: BASE, units: [{ ...unitScope, scopeHash: scopeHashFor({ moment: "pr", revision: HEAD, baseRevision: BASE, unit: unitScope }) }], diagnostics: [] };
    const { report } = await evaluateRun({ moment: "pr", resolvedConfig, catalogSnapshot: session.snapshot, resolvedUnits, scope, controls: controls || builtinControls(), repoRoot: repo, clock: () => NOW, platformKey: "conformance" });
    return report.results.find((e) => e.control.id === suite.control);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

/** ¿Este resultado podría bloquear si el control estuviera promovido (enforce, PR)? */
function eligibleUnderEnforce(e) {
  if (!e.result || !e.result.findings.length) return false;
  const draft = {
    ...e,
    level: "enforce",
    control: { ...e.control, enforcementContractVersion: "1.0.0", enforcementMoments: ["pr", "release"] },
    result: { ...e.result, decision: "deny" },
  };
  return draftViolations(draft).length === 0;
}

const rulesOf = (e) => [...new Set((e.result ? e.result.findings : []).map((f) => f.ruleId.split("/").pop()))].sort();
const fps = (e) => (e.result ? e.result.findings.map((f) => f.fingerprint) : []);

/**
 * @param {string} controlId
 * @param {{only?: string[], controls?: object}} [opts]  `controls` permite probar que la suite detecta implementaciones defectuosas.
 * @returns {Promise<{suite, ref, control, passed, cases: object[]}>}
 */
async function runConformance(controlId, opts = {}) {
  const meta = suiteFor(controlId);
  if (!meta) return { control: controlId, suite: null, passed: false, cases: [], reason: "sin suite de conformidad registrada" };
  const def = loadCases(meta.slug);
  const suite = { ...meta, control: def.control, profiles: def.profiles };
  const out = [];
  for (const c of def.cases.filter((x) => !opts.only || opts.only.includes(x.id))) {
    const a = await evaluateCase(suite, c, opts.controls);
    const b = await evaluateCase(suite, c, opts.controls);
    const failures = [];
    const exp = c.expect;
    const decision = a.result ? a.result.decision : "none";
    if (exp.decision && decision !== exp.decision) failures.push(`decisión ${decision} ≠ ${exp.decision}`);
    if (exp.rules && JSON.stringify(rulesOf(a)) !== JSON.stringify([...exp.rules].sort())) failures.push(`reglas [${rulesOf(a)}] ≠ [${[...exp.rules].sort()}]`);
    if (exp.reason && !(a.result && exp.reason.test(a.result.reason || ""))) failures.push("razón inesperada");
    const eligible = eligibleUnderEnforce(a);
    if (eligible !== exp.eligible) failures.push(`elegible en enforce=${eligible}, esperado ${exp.eligible}`);
    if (exp.deterministic !== false && (decision !== (b.result ? b.result.decision : "none") || JSON.stringify(fps(a)) !== JSON.stringify(fps(b)))) failures.push("no reproducible entre corridas");
    const outside = (a.result ? a.result.findings : []).filter((f) => !String(f.path || "").startsWith("apps/x/"));
    if (outside.length) failures.push(`findings no atribuibles a la unidad: ${outside.map((f) => f.path).join(", ")}`);
    if (a.blockingEligible) failures.push("en warn nada debe ser elegible para bloquear");
    out.push({ id: c.id, kind: c.kind, passed: failures.length === 0, failures, decision, rules: rulesOf(a), state: a.state, eligible });
  }
  const kinds = new Set(out.map((x) => x.kind));
  const coverage = ["positive", "negative", "edge"].every((k) => kinds.has(k)) || !!opts.only;
  return { control: controlId, suite: meta.id, version: meta.version, ref: suiteRef(meta), passed: coverage && out.every((x) => x.passed), coverage, cases: out };
}

module.exports = { runConformance, eligibleUnderEnforce, NOW };
