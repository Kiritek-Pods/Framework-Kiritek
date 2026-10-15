"use strict";

// T10: search.input-rate — suite contractual con reloj/transporte controlables.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCatalogSession } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { resolveEngineeringConfig } = require("../../../src/engineering/guardrails/config/index.js");
const { resolveUnits } = require("../../../src/engineering/guardrails/workspace/units.js");
const { scopeHashFor } = require("../../../src/engineering/guardrails/workspace/scope.js");
const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
const { builtinControls } = require("../../../src/engineering/guardrails/controls/index.js");
const { runSuite, createVirtualClock } = require("../../../src/engineering/guardrails/controls/search-input-rate/harness.js");
const { syntheticTexts, REQUIRED_SCENARIOS } = require("../../../src/engineering/guardrails/controls/search-input-rate/scenarios.js");
const { sweepArtifacts } = require("../../../src/engineering/guardrails/privacy/validate-output.js");
const { writeEvidence } = require("../../../src/engineering/guardrails/privacy/evidence-store.js");
const P = require("../helpers/pipeline.js");

const FIX = path.join(__dirname, "..", "fixtures", "search");
const SRC = path.join(__dirname, "..", "..", "..", "src", "engineering", "guardrails", "controls", "search-input-rate");
const CONTROL = "search.input-rate";
// Canarios = textos sintéticos con longitud de búsqueda real (≥ minChars).
const canariesFor = (params) => syntheticTexts(params).filter((t) => t.length >= params.minChars);
const PARAMS = { minChars: 3, windowMs: 250, strategy: "equivalent", dedupeWindowMs: 500, cancellation: "supported", equivalence: "trim-lowercase" };

function adapterModule(name) {
  const file = path.join(os.tmpdir(), `kiritek-eng-adapter-${process.pid}-${name}.js`);
  fs.writeFileSync(file, fs.readFileSync(path.join(FIX, `${name}.adapter.js.fixture`)));
  return require(file);
}

function contractDoc(over = {}) {
  return {
    schemaVersion: 1,
    control: CONTROL,
    triggers: "remote",
    cancellation: "supported",
    equivalence: "trim-lowercase",
    harness: { kind: "node-adapter", adapter: "apps/web/search.adapter.js" },
    ...over,
  };
}

/**
 * Repo temporal con unidad acme/web (perfiles web+search), contrato y
 * adapter. `catalog: "1.1.0"` usa el catálogo de prueba con enforce aprobado.
 */
async function runSearch({ adapter = "good-debounce", contract = contractDoc(), level = "warn", catalog = "1.0.0", noContract = false, files = {}, budgetPr, exceptions } = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-search-")));
  try {
    fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
    if (adapter) {
      fs.writeFileSync(path.join(repo, "apps/web/search.adapter.js"), fs.readFileSync(path.join(FIX, `${adapter}.adapter.js.fixture`)));
      if (adapter === "noisy") fs.writeFileSync(path.join(repo, "apps/web/good-debounce.adapter.js"), fs.readFileSync(path.join(FIX, "good-debounce.adapter.js.fixture")));
    }
    if (!noContract) fs.writeFileSync(path.join(repo, "apps/web/search.contract.json"), JSON.stringify(contract));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content);
    }
    const document = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog },
      workspace: {
        units: [
          {
            id: "acme/web",
            root: "apps/web",
            kind: "application",
            profiles: [{ id: "web", version: "1.0.0" }, { id: "search", version: "1.0.0" }],
            owns: ["apps/web/**"],
            controls: { [CONTROL]: { level, ...(noContract ? {} : { parameters: { behaviorContract: "apps/web/search.contract.json" } }) } },
          },
        ],
      },
    };
    const session = createCatalogSession(catalog === "1.1.0" ? P.catalogOptions() : {});
    let resolvedConfig = resolveEngineeringConfig({ document, env: {}, repoRoot: repo, catalogSession: session });
    if (budgetPr) {
      const effective = JSON.parse(JSON.stringify(resolvedConfig.effective));
      effective.execution.budgetsMs.pr = budgetPr;
      resolvedConfig = { ...resolvedConfig, effective };
    }
    const catalogSnapshot = session.snapshot;
    const resolvedUnits = resolveUnits(resolvedConfig, catalogSnapshot, { repoRoot: repo });
    const unitScope = { unitId: "acme/web", coverage: "direct", reasons: ["owns:apps/web/**"], paths: ["apps/web/search.ts"] };
    const scope = {
      moment: "pr",
      revision: P.HEAD,
      baseRevision: P.BASE,
      units: [{ ...unitScope, scopeHash: scopeHashFor({ moment: "pr", revision: P.HEAD, baseRevision: P.BASE, unit: unitScope }) }],
      diagnostics: [],
    };
    const out = await evaluateRun({
      moment: "pr",
      resolvedConfig,
      catalogSnapshot,
      resolvedUnits,
      scope,
      controls: builtinControls(),
      repoRoot: repo,
      exceptions,
      clock: () => P.NOW,
      platformKey: "test-platform",
    });
    const envelope = out.report.results.find((e) => e.control.id === CONTROL);
    return { ...out, envelope, repo };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const rules = (e) => (e.result ? e.result.findings.map((f) => f.ruleId.split("/")[1]).sort() : []);

// --- T10.1 harness ---------------------------------------------------------

test("T10.1 reloj virtual: timers en orden de tiempo y de creación", () => {
  const clock = createVirtualClock();
  const order = [];
  clock.setTimeout(() => order.push("b"), 20);
  const cancelled = clock.setTimeout(() => order.push("x"), 5);
  clock.setTimeout(() => order.push("a"), 10);
  clock.setTimeout(() => order.push("a2"), 10);
  clock.clearTimeout(cancelled);
  for (let t = clock.nextDue(100); t; t = clock.nextDue(100)) {
    clock.take(t);
    t.fn();
  }
  assert.deepEqual(order, ["a", "a2", "b"]);
  assert.equal(clock.now(), 20);
});

test("T10.1 suite determinista con consultas sintéticas opacas", async () => {
  const factory = adapterModule("good-debounce").createSearchUnderTest;
  const a = await runSuite(factory, PARAMS);
  const b = await runSuite(factory, PARAMS);
  assert.deepEqual(a, b, "misma entrada ⇒ misma traza");
  assert.deepEqual(a.scenarios.map((s) => s.id), REQUIRED_SCENARIOS);
  const texts = syntheticTexts(PARAMS);
  const serialized = JSON.stringify(a);
  for (const t of texts) assert.equal(serialized.includes(`"${t}"`), false, "la traza no contiene texto de consulta");
  for (const s of a.scenarios) {
    for (const e of s.events) {
      if (e.qid) assert.match(e.qid, /^q\d+$/);
      if (e.key) assert.match(e.key, /^k\d+$/);
    }
  }
  assert.ok(texts.every((t) => /^[zqxjvkwyh]+$/i.test(t)), "alfabeto sintético sin significado");
});

// --- T10.2 / T10.3 ---------------------------------------------------------

test("T10.2 collector: contrato sin contenido y seis escenarios con eventos opacos", async () => {
  const { report, evidence } = await runSearch();
  const e = report.results.find((x) => x.control.id === CONTROL);
  assert.equal(e.state, "evaluated");
  assert.equal(e.evidenceClass, "deterministic");
  assert.equal(e.evidenceCompleteness, "complete");
  assert.equal(evidence[0].observationRefs.length, 1 + REQUIRED_SCENARIOS.length);
});

test("T10.3 debounce y throttle cumplen: no se exige estrategia ni librería", async () => {
  for (const adapter of ["good-debounce", "good-throttle"]) {
    const { envelope } = await runSearch({ adapter });
    assert.equal(envelope.result.decision, "allow", adapter);
    assert.deepEqual(rules(envelope), [], adapter);
  }
});

// --- T10.4 ---------------------------------------------------------------

test("T10.4 detecta cadencia, mínimo, obsolescencia, cancelación, dedupe y propagación", async () => {
  const { envelope } = await runSearch({ adapter: "naive" });
  assert.deepEqual([...new Set(rules(envelope))], ["cadence", "cancellation", "dedupe", "minimum", "propagation", "stale-order"]);
  for (const f of envelope.result.findings) {
    assert.equal(f.path, "apps/web/search.contract.json");
    assert.match(f.fingerprint, /^sir:[a-z-]+:[a-z-]+$/);
  }
  assert.ok(envelope.findingEvidence.every((f) => f.evidenceClass === "deterministic"));
});

test("T10.4 sin soporte de cancelación no se exige cancelar, pero sí impedir obsolescencia", async () => {
  const { envelope } = await runSearch({ adapter: "naive", contract: contractDoc({ cancellation: "unsupported" }) });
  const r = rules(envelope);
  assert.equal(r.includes("cancellation"), false);
  assert.ok(r.includes("stale-order"));
});

test("T10.4 excepción de mínimo declarada y probada suprime la regla de mínimo", async () => {
  const { envelope } = await runSearch({
    adapter: "naive",
    contract: contractDoc({ minCharsException: { reason: "Búsqueda por código de 1-2 caracteres", testedBy: "apps/web/search.test.ts" } }),
  });
  assert.equal(rules(envelope).includes("minimum"), false);
});

// --- T10.5 heurísticas ------------------------------------------------------

test("T10.5 sin contrato: señales estáticas sólo avisan, incluso en enforce", async () => {
  const handler = "export function SearchBox(){ return <input onChange={(e) => fetch('/api/search?q=' + e.target.value)} /> }";
  for (const [level, catalog] of [["warn", "1.0.0"], ["enforce", "1.1.0"]]) {
    const { envelope, report } = await runSearch({ noContract: true, level, catalog, files: { "apps/web/SearchBox.tsx": handler } });
    assert.equal(envelope.result.decision, "warn", level);
    assert.equal(envelope.evidenceClass, "heuristic");
    assert.equal(envelope.blockingEligible, false);
    assert.equal(report.outcome.policyDeny, false);
    assert.match(envelope.result.reason, /evidencia conductual/);
    const f = envelope.result.findings[0];
    assert.equal(f.path, "apps/web/SearchBox.tsx");
    assert.deepEqual(envelope.findingEvidence, [{ fingerprint: f.fingerprint, evidenceClass: "heuristic" }]);
    assert.match(f.remediation, /heurística|no prueba/);
  }
});

// --- T10.6 ---------------------------------------------------------------

test("T10.6 adapter no determinista ⇒ conflict (flaky), nunca deny", async () => {
  const { envelope, report } = await runSearch({ adapter: "flaky", level: "enforce", catalog: "1.1.0" });
  assert.equal(envelope.state, "conflict");
  assert.ok(envelope.diagnostics.some((d) => d.code === "FLAKY_SCENARIO"));
  assert.equal(report.outcome.policyDeny, false);
});

test("T10.6 adapter que falla al montar ⇒ evidencia parcial, sin deny", async () => {
  const { envelope, report } = await runSearch({ adapter: "throws", level: "enforce", catalog: "1.1.0" });
  assert.notEqual(envelope.result && envelope.result.decision, "deny");
  assert.equal(report.outcome.policyDeny, false);
  assert.ok(envelope.diagnostics.some((d) => d.code === "ADAPTER_INIT_FAILED"));
});

test("T10.6 harness colgado ⇒ timeout operativo, sin deny", async () => {
  const { envelope, report } = await runSearch({ adapter: "hang", level: "enforce", catalog: "1.1.0", budgetPr: 3000 });
  assert.ok(["timeout", "evaluated"].includes(envelope.state));
  assert.ok(envelope.diagnostics.some((d) => d.code === "HARNESS_TIMEOUT"));
  assert.equal(report.outcome.policyDeny, false);
});

test("T10.6 salida del adapter aislada: las consultas impresas no llegan al reporte", async () => {
  const { envelope, report } = await runSearch({ adapter: "noisy" });
  assert.equal(envelope.result.decision, "allow");
  assert.deepEqual(sweepArtifacts({ report: JSON.stringify(report) }, { canaries: canariesFor(PARAMS) }), []);
});

test("T10.6 búsqueda local: warn sin N/A; not_applicable con N/A gobernado vigente", async () => {
  const local = await runSearch({ contract: contractDoc({ triggers: "local" }) });
  assert.equal(local.envelope.result.decision, "warn");
  assert.match(local.envelope.result.reason, /LOCAL_SEARCH_REQUIRES_GOVERNED_NA/);
  const na = { id: "NA-search-local", kind: "governed-na", unitId: "acme/web", controlId: CONTROL, expiresAt: "2026-12-31T00:00:00Z" };
  const governed = await runSearch({ contract: contractDoc({ triggers: "local" }), exceptions: [na] });
  assert.equal(governed.envelope.state, "not_applicable");
  assert.deepEqual(governed.envelope.suppressed.map((s) => s.ref), ["NA-search-local"]);
});

test("T10.6 contrato inválido o adapter fuera del repo ⇒ error/indisponible, no deny", async () => {
  const invalid = await runSearch({ contract: { schemaVersion: 1, control: CONTROL, triggers: "remote" } });
  assert.equal(invalid.envelope.result.decision, "error");
  assert.match(invalid.envelope.result.reason, /CONTRACT_INVALID/);
  const outside = await runSearch({ contract: contractDoc({ harness: { kind: "node-adapter", adapter: "apps/web/no-existe.js" } }), level: "enforce", catalog: "1.1.0" });
  assert.ok(outside.envelope.diagnostics.some((d) => d.code === "ADAPTER_NOT_FOUND"));
  assert.equal(outside.report.outcome.policyDeny, false);
});

test("T10.6 trace-command (stack no-JS): traza estándar válida; con texto de consulta se rechaza", async () => {
  const files = {
    "apps/web/emit-trace.js": fs.readFileSync(path.join(FIX, "emit-trace.js.fixture")),
    "apps/web/good-debounce.adapter.js": fs.readFileSync(path.join(FIX, "good-debounce.adapter.js.fixture")),
    "apps/web/harness.js": fs.readFileSync(path.join(SRC, "harness.js")),
    "apps/web/scenarios.js": fs.readFileSync(path.join(SRC, "scenarios.js")),
    "apps/shared/virtual-clock.js": fs.readFileSync(path.join(SRC, "..", "shared", "virtual-clock.js")),
  };
  const harness = (args) => ({ kind: "trace-command", command: "node", args, traceFile: "apps/web/out/search-trace.json" });
  const ok = await runSearch({ adapter: null, files, contract: contractDoc({ harness: harness(["emit-trace.js"]) }) });
  assert.equal(ok.envelope.result.decision, "allow");
  const leak = await runSearch({ adapter: null, files, contract: contractDoc({ harness: harness(["emit-trace.js", "--leak"]) }) });
  assert.ok(leak.envelope.diagnostics.some((d) => d.code === "TRACE_SCHEMA"));
  assert.equal(JSON.stringify(leak.report).includes("consulta real"), false);
});

// --- T10.7 gate --------------------------------------------------------------

test("T10.7 gate: en warn todo incumplimiento sólo avisa", async () => {
  const { envelope, report } = await runSearch({ adapter: "naive", level: "warn" });
  assert.equal(envelope.result.decision, "warn");
  assert.ok(envelope.result.findings.length >= 6);
  assert.equal(envelope.blockingEligible, false);
  assert.equal(report.outcome.policyDeny, false);
  assert.equal(report.outcome.exitCodeHint, 0);
});

test("T10.7 gate: la suite identifica fallos reproducibles y no filtra queries", async () => {
  const a = await runSearch({ adapter: "naive", level: "enforce", catalog: "1.1.0" });
  const b = await runSearch({ adapter: "naive", level: "enforce", catalog: "1.1.0" });
  // Sólo tras promoción explícita con contrato aprobado (catálogo de prueba) es elegible.
  assert.equal(a.envelope.result.decision, "deny");
  assert.equal(a.envelope.blockingEligible, true);
  assert.deepEqual(a.envelope.result.findings.map((f) => f.fingerprint), b.envelope.result.findings.map((f) => f.fingerprint));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-search-ev-")));
  try {
    for (const ev of a.evidence) writeEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", evidence: ev });
    const files = {};
    for (const f of fs.readdirSync(repo, { recursive: true }).map(String)) {
      const abs = path.join(repo, f);
      if (fs.statSync(abs).isFile()) files[f] = fs.readFileSync(abs, "utf8");
    }
    const canaries = canariesFor(PARAMS);
    assert.deepEqual(sweepArtifacts({ report: JSON.stringify(a.report), ...files }, { canaries }), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
