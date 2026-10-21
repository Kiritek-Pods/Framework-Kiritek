"use strict";

// T16: demostración R27 — nada no determinista bloquea; un fallo determinista
// fresco y atribuible sólo bloquea tras promoción explícita con contrato
// aprobado; warn y enforce comparten todo salvo la decisión elegible;
// presupuestos degradan sin omitir; nada sensible se filtra; doctor niega la
// promoción ante cualquier requisito faltante; la promoción queda registrada.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("../helpers/git-isolation.js").isolateGit();

const P = require("../helpers/pipeline.js");
const H = require("../helpers/catalogs.js");
const { CONFIG, git, write, makeRepo, runCli } = require("../helpers/surfaces-repo.js");
const { sweepArtifacts } = require("../../../src/engineering/guardrails/privacy/validate-output.js");
const { syntheticTexts } = require("../../../src/engineering/guardrails/controls/search-input-rate/scenarios.js");
const { readPromotions } = require("../../../src/engineering/guardrails/audit/readiness.js");

const FIX = path.join(__dirname, "..", "fixtures");
const VERSION = "app.minimum-supported-version";
const SUITE = "kiritek/engineering/app-minimum-supported-version";
const clean = (d) => fs.rmSync(d, { recursive: true, force: true });

// --- T16.3 -------------------------------------------------------------------------------

const limited = (status, confidence = "medium") => ({ status, confidence, limitations: [{ code: status.toUpperCase(), message: `observación ${status}` }] });
const NON_BLOCKING = {
  regex: { mechanism: "static-analysis", evidenceClass: "heuristic", confidence: "low", facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1, signal: "regex" } },
  "ast-parcial": { mechanism: "static-analysis", evidenceClass: "heuristic", confidence: "medium", facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1, signal: "ast-partial" } },
  nombre: { mechanism: "static-analysis", evidenceClass: "heuristic", confidence: "low", facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1, signal: "name" } },
  ruta: { mechanism: "manifest", evidenceClass: "heuristic", confidence: "low", facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1, signal: "path" } },
  dependencia: { mechanism: "manifest", evidenceClass: "heuristic", confidence: "low", facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1, signal: "dependency" } },
  timeout: limited("timeout"),
  parcial: limited("partial"),
  unavailable: limited("unavailable", "unknown"),
  conflict: limited("conflict", "high"),
  invalid: limited("invalid", "unknown"),
  stale: { cache: "hit", observedAt: "2026-09-01T00:00:00Z" },
  "mismatch-config": { cache: "hit", configHash: `sha256:${"e".repeat(64)}` },
};
const alwaysDeny = {
  version: "1.0.0",
  evaluate: (input) => ({
    decision: "deny",
    findings: input.observations.map((o) => ({ ruleId: `${P.CONTROL}/cadence`, path: "apps/web/search.ts", severity: "high", fingerprint: `fp-${o.observationId}`, evidenceClass: "deterministic", observationRefs: [o.observationId] })),
    reason: "evaluator que siempre deniega",
  }),
};

test("T16.3 regex, AST parcial, nombre/ruta/dependencia, timeout, parcial, unavailable, conflict, invalid, stale y mismatch jamás producen policy deny (enforce, PR y release)", async () => {
  for (const moment of ["pr", "release"]) {
    for (const [cause, over] of Object.entries(NON_BLOCKING)) {
      const { report } = await P.run({ level: "enforce", moment, control: { observations: [P.burstObservation(over)], evaluator: alwaysDeny } });
      const e = P.envelopeOf(report);
      assert.equal(report.outcome.policyDeny, false, `${moment}/${cause}`);
      assert.notEqual(e.result && e.result.decision, "deny", `${moment}/${cause}: ${e.state}`);
      assert.equal(e.blockingEligible, false);
    }
  }
  const control = await P.run({ level: "enforce", moment: "pr", control: { observations: [P.burstObservation()], evaluator: alwaysDeny } });
  assert.equal(control.report.outcome.policyDeny, true, "control positivo: lo determinista fresco sí bloquea");
});

test("T16.3 perfil sólo sugerido y momentos sin contrato de enforcement jamás bloquean", async () => {
  const suggested = await P.run({ webProfiles: ["web"], level: "enforce", suggestions: [{ unitId: "acme/web", profile: { id: "search" } }], control: { evaluator: alwaysDeny } });
  assert.equal(suggested.report.outcome.policyDeny, false);
  assert.notEqual(P.envelopeOf(suggested.report).state, "evaluated");
  for (const moment of ["agent", "pre-commit"]) {
    const r = await P.run({ level: "enforce", moment, control: { evaluator: alwaysDeny } });
    assert.equal(r.report.outcome.policyDeny, false, moment);
  }
});

// --- Repo con app-min promovible (catálogo de prueba con la suite R27 canónica) -----------

let catalogRoot = null;
function catalogOptions(approvedVersion = "1.0.0") {
  if (!catalogRoot) {
    catalogRoot = H.tmpDir("kiritek-eng-r27-cat-");
    for (const [v, av] of [["1.2.0", "1.0.0"], ["1.3.0", "2.0.0"]]) {
      H.writeCatalog(catalogRoot, H.buildFiles((d) => {
        d.version = v;
        const ctl = d.controls.find((c) => c.id === VERSION);
        ctl.supportedLevels = ["off", "warn", "enforce"];
        ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: SUITE, approvedVersion: av, moments: ["pr", "release"] };
      }));
    }
    process.on("exit", () => fs.rmSync(catalogRoot, { recursive: true, force: true }));
  }
  return { roots: [catalogRoot], approvedConformanceSuites: [`${SUITE}@${approvedVersion}`] };
}

/** Repo listo para promover app-min (evidencia PR + release, CI, CODEOWNERS). */
async function readyRepo({ adapter = "lexicographic" } = {}) {
  const r = makeRepo();
  const { repo } = r;
  const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
  doc.pack.catalog = "1.2.0";
  write(repo, CONFIG, JSON.stringify(doc, null, 2));
  write(repo, "apps/mobile/gate.adapter.js", fs.readFileSync(path.join(FIX, "version", `${adapter}.adapter.js.fixture`)));
  write(repo, ".github/CODEOWNERS", "apps/mobile/ @acme/mobile\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "preparar promoción");
  const head = git(repo, "rev-parse", "HEAD");
  const deps = { catalogOptions: catalogOptions() };
  assert.equal((await runCli(["install", "--surfaces=ci"], repo, deps)).code, 0);
  const pr = await runCli(["scan", "--moment=pr", `--base=${r.base}`, `--revision=${head}`, "--offline"], repo, deps);
  const rel = await runCli(["scan", "--moment=release", "--unit=acme/mobile", `--revision=${head}`, "--artifact=dist/app.aab", "--offline"], repo, deps);
  return { ...r, head, deps, pr, rel };
}

const envOf = (json) => json.results.find((e) => e.unit.id === "acme/mobile" && e.control.id === VERSION);

// --- T16.4 / T16.5 / T16.10 -----------------------------------------------------------------

test("T16.4/T16.5/T16.10 deny sólo tras promoción explícita; warn y enforce comparten alcance y findings; promoción registrada y reversible", async () => {
  const { repo, base, head, deps, pr } = await readyRepo();
  try {
    assert.equal(pr.code, 0, "en warn un fallo determinista sólo avisa");
    const warnEnv = envOf(pr.json);
    assert.equal(warnEnv.result.decision, "warn");
    assert.ok(warnEnv.result.findings.length > 0);

    const promoted = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=enforce", "--actor=ana.dev"], repo, { ...deps, env: { CI: "true" } });
    assert.equal(promoted.code, 0, JSON.stringify(promoted.json.blockers));
    const enforced = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo, deps);
    assert.equal(enforced.code, 1, "deny determinista fresco y atribuible tras promoción");
    const enfEnv = envOf(enforced.json);
    assert.equal(enfEnv.result.decision, "deny");
    assert.equal(enfEnv.blockingEligible, true);

    // T16.5: mismo alcance, evidencia y findings; sólo cambia la decisión elegible.
    const shape = (e) => ({ scopeHash: e.scopeHash, state: e.state, evidenceClass: e.evidenceClass, evidenceCompleteness: e.evidenceCompleteness, findings: e.result.findings.map((f) => [f.ruleId, f.fingerprint, f.path, f.severity]), findingEvidence: e.findingEvidence });
    assert.deepEqual(shape(enfEnv), shape(warnEnv));
    assert.deepEqual([warnEnv.level, enfEnv.level], ["warn", "enforce"]);
    assert.deepEqual([warnEnv.blockingEligible, enfEnv.blockingEligible], [false, true]);
    const others = (j) => j.results.filter((e) => e.control.id !== VERSION).map((e) => [e.unit.id, e.control.id, e.level, e.result && e.result.decision]);
    assert.deepEqual(others(enforced.json), others(pr.json), "ningún otro par cambia");

    const back = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=warn"], repo, deps);
    assert.equal(back.code, 0);
    assert.equal((await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo, deps)).code, 0, "rollback inmediato");

    const log = readPromotions(repo);
    assert.equal(log.length, 2);
    assert.deepEqual(log.map((e) => [e.from, e.to, e.actor, e.origin]), [["warn", "enforce", "ana.dev", "ci"], ["enforce", "warn", "unknown", "cli"]]);
    assert.notEqual(log[0].configHashBefore, log[0].configHashAfter);
    assert.equal(log[1].configHashAfter, log[0].configHashBefore, "el rollback vuelve a la config anterior");
    assert.ok(log[0].evidence.some((e) => e.moment === "pr" && e.evidenceRef) && log[0].evidence.some((e) => e.moment === "release"));
    assert.equal(log[0].readiness.ready, true);
  } finally {
    clean(repo);
  }
});

// --- T16.9 ------------------------------------------------------------------------------------

test("T16.9 doctor niega la promoción ante cualquier requisito faltante (CI, evidencia, release, integridad, presupuesto, suite R27)", async () => {
  const { repo, deps } = await readyRepo();
  const doctor = async (dir, d = deps) => (await runCli(["doctor", "--unit=acme/mobile", `--control=${VERSION}`], dir, d)).json;
  try {
    const ok = await doctor(repo);
    assert.equal(ok.readiness, "ready", JSON.stringify(ok.blockers));
    assert.ok(ok.targets[0].checks.some((c) => c.id === "conformance-suite" && c.passed));
    const perturbations = {
      "surface:pr": (d) => fs.rmSync(path.join(d, ".github/workflows/kiritek-engineering.yml")),
      "evidence:pr": (d) => {
        write(d, "apps/web/src/app.ts", "export const app = 9;\n");
        git(d, "add", "-A");
        git(d, "commit", "-q", "-m", "nuevo commit");
      },
      "evidence:release": (d) => fs.rmSync(path.join(d, ".kiritek/evidence/engineering/runs/release.json")),
      integrity: (d) => fs.appendFileSync(path.join(d, ".kiritek/.gitignore"), "x/\n"),
      "budget:pr": (d) => {
        const p = path.join(d, ".kiritek/evidence/engineering/runs/pr.json");
        const l = JSON.parse(fs.readFileSync(p, "utf8"));
        l.results.find((x) => x.unitId === "acme/mobile" && x.controlId === VERSION).durationMs = 10 ** 7;
        fs.writeFileSync(p, JSON.stringify(l));
      },
    };
    for (const [check, perturb] of Object.entries(perturbations)) {
      const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-r27-p-")));
      try {
        fs.cpSync(repo, copy, { recursive: true });
        perturb(copy);
        const res = await doctor(copy);
        assert.equal(res.readiness, "not-ready", check);
        assert.ok(res.targets[0].checks.some((c) => c.id === check && !c.passed), `${check}: ${res.blockers.join(" | ")}`);
      } finally {
        clean(copy);
      }
    }
    // Suite R27 distinta a la registrada (contrato apunta a 2.0.0): no listo.
    const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-r27-s-")));
    try {
      fs.cpSync(repo, copy, { recursive: true });
      const doc = JSON.parse(fs.readFileSync(path.join(copy, CONFIG), "utf8"));
      doc.pack.catalog = "1.3.0";
      write(copy, CONFIG, JSON.stringify(doc, null, 2));
      const res = await doctor(copy, { catalogOptions: catalogOptions("2.0.0") });
      assert.ok(res.targets[0].checks.some((c) => c.id === "conformance-suite" && !c.passed), res.blockers.join(" | "));
    } finally {
      clean(copy);
    }
  } finally {
    clean(repo);
  }
});

// --- T16.6 ------------------------------------------------------------------------------------

test("T16.6 presupuesto agotado: degradación explícita (timeout/BUDGET_EXHAUSTED) sin omitir pares ni bloquear; telemetría la registra", async () => {
  const { repo, base, head } = makeRepo();
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    doc.execution = { budgetsMs: { pr: 1 } };
    doc.telemetry = { enabled: true, categories: ["control-status", "duration", "error-category"] };
    write(repo, CONFIG, JSON.stringify(doc, null, 2));
    const r = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo);
    assert.notEqual(r.code, 1);
    assert.equal(r.json.outcome.policyDeny, false);
    assert.equal(r.json.results.length, 6, "2 unidades × 3 controles: ninguno se omite en silencio");
    const applicable = r.json.results.filter((e) => e.state !== "not_applicable");
    assert.ok(applicable.length >= 3);
    for (const e of applicable) {
      assert.equal(e.state, "timeout", `${e.unit.id}/${e.control.id}`);
      assert.ok(e.diagnostics.some((d) => ["BUDGET_EXHAUSTED", "TIMEOUT"].includes(d.code)), e.diagnostics.map((d) => d.code).join(","));
    }
    const events = fs.readFileSync(path.join(repo, ".kiritek/telemetry/engineering/events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(events.length >= 3 && events.every((e) => e.errorCategory === "timeout"));
  } finally {
    clean(repo);
  }
});

// --- T16.7 ------------------------------------------------------------------------------------

test("T16.7 barrido: stdout/stderr, reportes, cache, evidencia, registros y telemetría sin queries, payloads, prompts, PII ni canarios", async () => {
  const { repo, base, head } = makeRepo();
  const outputs = {};
  try {
    write(repo, "apps/mobile/gate.adapter.js", fs.readFileSync(path.join(FIX, "version", "leaky.adapter.js.fixture")));
    write(repo, "apps/web/announce.adapter.js", fs.readFileSync(path.join(FIX, "announcement", "leaky.adapter.js.fixture")));
    write(repo, "apps/web/good-debounce.adapter.js", fs.readFileSync(path.join(FIX, "search", "good-debounce.adapter.js.fixture")));
    write(repo, "apps/web/search.adapter.js", fs.readFileSync(path.join(FIX, "search", "noisy.adapter.js.fixture")));
    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    doc.telemetry = { enabled: true };
    write(repo, CONFIG, JSON.stringify(doc, null, 2));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "adapters ruidosos");
    const h = git(repo, "rev-parse", "HEAD");
    const prompt = "KCANARY-prompt-91ab";
    const event = (tool, key, p) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { [key]: p, content: `${prompt} contraseña=KCANARY-payload-55cd` }, prompt });
    const runs = [
      ["install", "--surfaces=kiro,claude,git"],
      ["hook", "kiro"],
      ["hook", "claude"],
      ["scan", "--moment=pre-commit", "--offline"],
      ["scan", "--moment=pr", `--base=${base}`, `--revision=${h}`, "--offline"],
      ["scan", "--moment=release", "--unit=acme/web", `--revision=${h}`, "--artifact=dist/web.tgz", "--offline"],
      ["scan", "--moment=release", "--unit=acme/mobile", `--revision=${h}`, "--artifact=dist/app.aab", "--offline"],
      ["audit", "--deep"],
      ["doctor"],
      ["telemetry", "status"],
    ];
    for (const argv of runs) {
      const extra = argv[0] === "hook" ? { stdinText: argv[1] === "kiro" ? event("fs_write", "path", "apps/web/launch.json") : event("Write", "file_path", path.join(repo, "apps/web/launch.json")) } : {};
      const r = await runCli(argv, repo, extra);
      outputs[`${argv.join(" ")} (stdout)`] = r.out;
      outputs[`${argv.join(" ")} (stderr)`] = r.err;
    }
    const files = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile()) files[path.relative(repo, abs)] = fs.readFileSync(abs, "utf8");
      }
    };
    walk(path.join(repo, ".kiritek"));
    assert.ok(Object.keys(files).some((f) => f.includes("evidence")) && Object.keys(files).some((f) => f.includes("telemetry")));
    const params = { minChars: 3, windowMs: 250, strategy: "equivalent", dedupeWindowMs: 500, cancellation: "supported", equivalence: "trim-lowercase" };
    const canaries = ["KCANARY-device-1f2e", "KCANARY-account-9a8b", "KCANARY-store-7c6d", "KCANARY-mail-3b4c", "KCANARY-user-5d6e", "KCANARY-track-7f80", prompt, "KCANARY-payload-55cd", ...syntheticTexts(params).filter((t) => t.length >= params.minChars)];
    assert.deepEqual(sweepArtifacts({ ...outputs, ...files }, { canaries }), []);
  } finally {
    clean(repo);
  }
});
