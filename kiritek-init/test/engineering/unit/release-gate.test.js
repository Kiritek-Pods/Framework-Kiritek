"use strict";

// T17: gate de release. Bloquea sin matriz completa, con suite del repo en
// rojo o árbol sucio; la aprobación sólo acepta evidencia ready y liga las
// suites R27 a su digest.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..", "..");
const { parseTap, listTestFiles } = require("../../../release/gate/jobs.js");
const { evaluateGate, applyApproval, matrixCoverage, CANDIDATE_REL } = require("../../../release/gate/gate.js");
const { REQUIRED_JOBS, CRITERIA } = require("../../../release/gate/criteria.js");
const { SUITES, suiteDigest, suiteRef, approvedSuites } = require("../../../src/engineering/guardrails/conformance/registry.js");
const { resolveCatalog } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { buildCandidate } = require("../../../scripts/build-catalog-candidate.js");

const REV = "a".repeat(40);
const CONF_DIR = path.join(ROOT, "src", "engineering", "guardrails", "conformance");

const conformanceOk = () => ({
  suites: Object.entries(SUITES).map(([control, s]) => ({ control, ref: suiteRef(s), digest: suiteDigest(s.slug), passed: true, cases: 1, kinds: {}, failed: [] })),
  result: { id: "conformance-suites", passed: true, detail: "stub" },
});

function job({ os: platform, node, suite, revision = REV, fail = [] }) {
  const files = listTestFiles(suite).map((file) => ({ file, exit: fail.includes(file) ? 1 : 0, tests: 1, pass: fail.includes(file) ? 0 : 1, fail: fail.includes(file) ? 1 : 0, skipped: 0, todo: 0, cancelled: 0, failures: fail.includes(file) ? ["algo falla"] : [] }));
  return { schemaVersion: 1, kind: "kiritek-init/test-job", os: platform, node: `${node}.0.0`, suite, revision, files, totals: {}, status: fail.length ? "fail" : "pass" };
}
const fullMatrix = (mut = (j) => j) => REQUIRED_JOBS.map((r) => mut(job(r)));
const gate = (jobs, extra = {}) => evaluateGate({ jobs, now: () => "2026-10-13T00:00:00.000Z", overrides: { revision: REV, dirty: false, conformance: conformanceOk(), ...extra } });

test("T17 parseTap: conteos del trailer y nombres de los tests de primer nivel que fallan", () => {
  const r = parseTap("TAP version 13\nok 1 - a\nnot ok 2 - b falla\n    not ok 1 - anidado\nok 3 - c # SKIP win32\n1..3\n# tests 3\n# pass 1\n# fail 1\n# skipped 1\n");
  assert.deepEqual([r.tests, r.pass, r.fail, r.skipped], [3, 1, 1, 1]);
  assert.deepEqual(r.failures, ["b falla"]);
});

test("T17 cada archivo de test engineering está asignado a un criterio", () => {
  const files = listTestFiles("engineering").map((f) => f.replace(/^test\/engineering\//, ""));
  const assigned = new Set(CRITERIA.flatMap((c) => c.tests));
  assert.deepEqual(files.filter((f) => !assigned.has(f)), []);
  assert.deepEqual([...assigned].filter((f) => !files.includes(f)), []);
});

test("T17 la aprobación de una suite R27 queda ligada al digest de su contenido", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gate-appr-"));
  try {
    const s = SUITES["search.input-rate"];
    const file = path.join(dir, "approved.json");
    const write = (approved) => fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, approved }));
    write([{ ref: suiteRef(s), digest: suiteDigest(s.slug) }]);
    assert.deepEqual(approvedSuites({ file }), [suiteRef(s)]);
    write([{ ref: suiteRef(s), digest: `sha256:${"0".repeat(64)}` }]);
    assert.deepEqual(approvedSuites({ file }), [], "digest distinto: no aprobada");
    write([suiteRef(s), { ref: "otra/suite@1.0.0", digest: suiteDigest(s.slug) }]);
    assert.deepEqual(approvedSuites({ file }), [], "strings sin digest y suites fuera del registro no cuentan");
    assert.deepEqual(approvedSuites(), [], "el pack no trae suites aprobadas mientras el gate esté bloqueado");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T17.7 el candidato 2.0.0 es reproducible, no carga sin aprobación y sólo admite enforce determinista en pr/release", () => {
  const { doc, files } = buildCandidate();
  const disk = fs.readFileSync(path.join(ROOT, CANDIDATE_REL, "catalog.json"));
  assert.ok(files["catalog.json"].equals(disk), "el builder reproduce el candidato en disco");
  const roots = [path.dirname(path.join(ROOT, CANDIDATE_REL))];
  assert.throws(() => resolveCatalog({ version: "2.0.0", roots }), (e) => e.code === "CATALOG_CONFORMANCE_FAILED");
  const refs = Object.values(SUITES).map(suiteRef);
  assert.equal(resolveCatalog({ version: "2.0.0", roots, approvedConformanceSuites: refs }).catalog.version, "2.0.0");
  for (const c of doc.controls) {
    assert.deepEqual(c.enforcementContract.evidenceTypes, ["deterministic"]);
    assert.deepEqual(c.enforcementContract.moments, ["pr", "release"]);
    assert.equal(c.defaults.level, "warn");
    assert.equal(c.version, "1.0.0", "comportamiento sin cambios: waivers por versión siguen vigentes");
  }
});

test("T17 sin evidencia de la matriz el gate queda blocked y el pack sigue warning-only", async () => {
  const ev = await gate([]);
  assert.equal(ev.status, "blocked");
  assert.match(ev.decision, /warning-only/);
  assert.deepEqual(ev.matrix.missing.length, REQUIRED_JOBS.length);
  assert.ok(ev.gaps.some((g) => g.id === "platform-matrix-missing"));
  const t173 = ev.criteria.find((c) => c.id === "T17.3");
  assert.equal(t173.passed, false);
  assert.ok(t173.checks.filter((k) => k.id.startsWith("test:")).every((k) => /ningún job/.test(k.detail)));
});

test("T17 con la matriz completa en verde, árbol limpio y suites R27 el gate queda ready", async () => {
  const ev = await gate(fullMatrix());
  assert.deepEqual(ev.gaps, []);
  assert.equal(ev.status, "ready", JSON.stringify(ev.criteria.filter((c) => !c.passed).map((c) => c.checks.filter((k) => !k.passed))));
  assert.equal(ev.criteria.length, 7);
  assert.ok(!JSON.stringify(ev).includes(ROOT), "la evidencia no lleva rutas absolutas");
});

test("T17 bloquean: job de otra revisión, Windows en rojo, suite del repo en rojo, árbol sucio, suite R27 fallida", async () => {
  const stale = await gate(fullMatrix((j) => (j.os === "win32" ? { ...j, revision: "b".repeat(40) } : j)));
  assert.equal(stale.status, "blocked");
  assert.deepEqual(stale.matrix.missing, ["win32/node22/engineering"]);
  assert.equal(stale.matrix.stale.length, 1);

  const winRed = await gate(fullMatrix((j) => (j.os === "win32" ? job({ ...j, node: "22", fail: ["test/engineering/unit/adapters.test.js"] }) : j)));
  assert.deepEqual(winRed.matrix.failing, ["win32/node22/engineering"]);
  assert.equal(winRed.criteria.find((c) => c.id === "T17.6").passed, false);

  const external = listTestFiles("full").find((f) => !f.startsWith("test/engineering/"));
  const repoRed = await gate(fullMatrix((j) => (j.suite === "full" && j.os === "linux" ? job({ os: "linux", node: "22", suite: "full", fail: [external] }) : j)));
  assert.equal(repoRed.status, "blocked");
  assert.ok(repoRed.gaps.some((g) => g.id === "repo-suite-external" && g.detail.startsWith(external)));

  const dirty = await gate(fullMatrix(), { dirty: true });
  assert.ok(dirty.gaps.some((g) => g.id === "worktree-dirty"));

  const conf = conformanceOk();
  conf.suites[0].passed = false;
  conf.result = { id: "conformance-suites", passed: false, detail: "falla" };
  const confRed = await gate(fullMatrix(), { conformance: conf });
  assert.equal(confRed.status, "blocked");
  assert.equal(confRed.criteria.find((c) => c.id === "T17.3").passed, false);
});

test("T17 matriz: un job full cubre también la fila engineering del mismo SO/Node", () => {
  const m = matrixCoverage([job({ os: "linux", node: "18", suite: "full" })], REV);
  assert.ok(m.covered.includes("linux/node18/engineering"));
});

test("T17.7 approve: rechaza evidencia blocked o de otra revisión; con ready publica catálogo, aprobación por digest, pin y procedencia", async () => {
  const blocked = await gate([]);
  assert.throws(() => applyApproval({ evidence: blocked, revision: REV }), (e) => e.code === "RELEASE_GATE_NOT_READY");
  const ready = await gate(fullMatrix());
  assert.throws(() => applyApproval({ evidence: ready, revision: "c".repeat(40) }), /revisión actual/);

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gate-root-")));
  try {
    for (const rel of ["src", "schemas", "catalogs", "release/candidates", "templates/engineering"]) fs.cpSync(path.join(ROOT, rel), path.join(tmp, rel), { recursive: true });
    const res = applyApproval({ evidence: ready, root: tmp, revision: REV, now: () => "2026-10-13T00:00:00.000Z" });

    const tplPin = JSON.parse(fs.readFileSync(path.join(tmp, "templates/engineering/guardrails/config/kiritek-engineering.config.json"), "utf8")).pack.catalog;
    assert.equal(tplPin, "2.0.0");
    const tmpConf = path.join(tmp, "src", "engineering", "guardrails", "conformance");
    const approved = approvedSuites({ file: path.join(tmpConf, "approved.json"), root: tmpConf });
    assert.equal(approved.length, Object.keys(SUITES).length);
    const snap = resolveCatalog({ version: "2.0.0", roots: [path.join(tmp, "catalogs", "engineering", "guardrails")], approvedConformanceSuites: approved });
    assert.equal(snap.catalog.digest, ready.candidate.digest);

    const prov = JSON.parse(fs.readFileSync(path.join(tmp, res.provenance), "utf8"));
    for (const f of prov.files) assert.equal(f.digest, `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, f.path))).digest("hex")}`, f.path);
    assert.equal(prov.gateEvidence.digest, `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, res.evidence))).digest("hex")}`);
    assert.ok(!JSON.stringify(prov).includes(tmp), "procedencia sin rutas absolutas");

    // Tocar un adapter de referencia retira la aprobación de esa suite.
    const ref = path.join(tmpConf, "reference", "search-input-rate");
    fs.appendFileSync(path.join(ref, fs.readdirSync(ref)[0]), "\n// cambio\n");
    assert.equal(approvedSuites({ file: path.join(tmpConf, "approved.json"), root: tmpConf }).length, Object.keys(SUITES).length - 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.deepEqual(approvedSuites(), [], "el repo real no se toca");
  assert.ok(!fs.existsSync(path.join(ROOT, "catalogs", "engineering", "guardrails", "2.0.0")));
});

test("T17.7 update 1.0.0 → 2.0.0: los controles nuevos quedan en off y los niveles actuales se conservan", () => {
  const { planCatalogChange } = require("../../../src/engineering/guardrails/install/lifecycle.js");
  const { BUILTIN_ROOT } = require("../../../src/engineering/guardrails/catalog/registry.js");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gate-upd-"));
  try {
    const doc = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog: "1.0.0" },
      workspace: { units: [{ id: "acme/web", root: "apps/web", kind: "application", profiles: [{ id: "web", version: "1.0.0" }, { id: "search", version: "1.0.0" }], owns: ["apps/web/**"] }] },
    };
    const catalogOptions = { roots: [BUILTIN_ROOT, path.dirname(path.join(ROOT, CANDIDATE_REL))], approvedConformanceSuites: Object.values(SUITES).map(suiteRef) };
    const plan = planCatalogChange({ repoRoot: repo, doc, to: "2.0.0", catalogOptions });
    const { NEW_CONTROLS } = require("../../../scripts/build-catalog-candidate.js");
    assert.deepEqual([...plan.newGates].sort(), NEW_CONTROLS.map((c) => c.id).sort());
    assert.equal(plan.newGates.length, NEW_CONTROLS.length);
    for (const id of plan.newGates) assert.deepEqual(plan.nextDoc.defaults.controls[id], { level: "off" });
    assert.equal(plan.nextDoc.pack.catalog, "2.0.0");
    assert.equal(plan.blocked, false);
    assert.deepEqual(plan.levelChanges.filter((c) => c.from !== null), [], "ningún nivel existente cambia");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
