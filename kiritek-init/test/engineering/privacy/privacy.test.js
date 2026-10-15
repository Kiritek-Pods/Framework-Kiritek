"use strict";

// T08: minimización, redacción, detector final, evidencia y canarios.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { minimizeBySchema } = require("../../../src/engineering/guardrails/privacy/minimize.js");
const { removeForbiddenFields, sanitizeString } = require("../../../src/engineering/guardrails/privacy/redact.js");
const { detectLeaks, sweepArtifacts, luhn } = require("../../../src/engineering/guardrails/privacy/validate-output.js");
const { prepareForPublication, publishJson } = require("../../../src/engineering/guardrails/privacy/publish.js");
const { writeEvidence, readEvidence } = require("../../../src/engineering/guardrails/privacy/evidence-store.js");
const { createObservationCache } = require("../../../src/engineering/guardrails/runtime/cache.js");
const { FORBIDDEN_FIELDS } = require("../../../src/engineering/guardrails/contracts/common.js");
const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
const P = require("../helpers/pipeline.js");

function tmpRepo() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-priv-")));
}

function readTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { recursive: true }).map(String)) {
    const abs = path.join(dir, f);
    if (fs.statSync(abs).isFile()) out[f] = fs.readFileSync(abs, "utf8");
  }
  return out;
}

// --- T08.1 minimización --------------------------------------------------

test("T08.1 minimización por schema descarta todo lo no declarado", async () => {
  const { report } = await P.run();
  const polluted = JSON.parse(JSON.stringify(report));
  polluted.debug = { stack: "x" };
  polluted.results[0].internalNotes = "no publicar";
  polluted.outcome.extra = true;
  const min = minimizeBySchema(polluted, "engineering/report");
  assert.equal("debug" in min, false);
  assert.equal("internalNotes" in min.results[0], false);
  assert.equal("extra" in min.outcome, false);
  assert.deepEqual(min.results, JSON.parse(JSON.stringify(report.results)));
});

test("T08.1 el reporte publicado sólo contiene metadatos (sin facts ni observaciones)", async () => {
  const { report } = await P.run();
  const text = JSON.stringify(report);
  for (const k of ['"facts"', '"observations"', '"requestsStarted"', '"paths"']) assert.equal(text.includes(k), false, k);
  assert.match(text, /"scopeHash"/);
});

// --- T08.2 redacción -----------------------------------------------------

test("T08.2 elimina campos prohibidos en cualquier profundidad; conserva códigos de diagnóstico", () => {
  const input = { a: { query: "q", nested: [{ payload: "p", ok: 1 }] }, diagnostics: [{ code: "TIMEOUT", message: "m" }], snippet: { code: "const x = 1" } };
  const { value, removed } = removeForbiddenFields(input);
  assert.deepEqual(value, { a: { nested: [{ ok: 1 }] }, diagnostics: [{ code: "TIMEOUT", message: "m" }] });
  assert.deepEqual(removed.sort(), ["$.a.nested[0].payload", "$.a.query", "$.snippet"]);
});

test("T08.2 sanea URLs, cabeceras de autorización y rutas absolutas", () => {
  const repo = "/Users/dev/repo";
  assert.equal(sanitizeString("ver https://user:pw@host.example.invalid/a/b?token=x#frag", {}), "ver https://host.example.invalid/a/b");
  assert.equal(sanitizeString("Authorization: Bearer abc.def.ghi", {}), "Authorization: [redactado]");
  assert.equal(sanitizeString(`falló en ${repo}/apps/web/a.ts`, { repoRoot: repo }), "falló en apps/web/a.ts");
  assert.equal(sanitizeString("leyó /etc/hosts", { repoRoot: repo }), "leyó [ruta-absoluta]");
  assert.equal(sanitizeString("leyó C:\\Users\\dev\\x.txt", {}), "leyó [ruta-absoluta]");
  assert.equal(sanitizeString("apps/web/a.ts sin cambios", { repoRoot: repo }), "apps/web/a.ts sin cambios");
});

// --- T08.3 orden y detector final ------------------------------------------

test("T08.3 el detector final rechaza credenciales, PII y canarios sin repetir el valor", () => {
  assert.equal(luhn("4111111111111111"), true);
  assert.equal(luhn("4111111111111112"), false);
  const cases = {
    credential: "ghp_" + "Z".repeat(36),
    email: "persona@empresa.example",
    "card-number": "4111-1111-1111-1111",
    canary: "KCANARY-xyz",
  };
  for (const [kind, v] of Object.entries(cases)) {
    const leaks = detectLeaks({ msg: `x ${v} y` }, { canaries: ["KCANARY-xyz"] });
    assert.ok(leaks.some((l) => l.kind === kind), kind);
  }
  assert.deepEqual(detectLeaks({ h: `sha256:${"1234567890".repeat(6)}abcd`, rev: "0123456789abcdef0123456789abcdef01234567", at: "2026-10-05T12:00:00Z" }), [], "hashes y fechas no son falsos positivos");
});

test("T08.3 un fallo en cualquier etapa impide publicar y no escribe nada", () => {
  const repo = tmpRepo();
  try {
    const evidence = (over = {}) => ({ ...P_EVIDENCE(), ...over });
    assert.throws(() => publishJson(repo, "out/ev.json", evidence({ reportRef: "contacto ana@empresa.example" }), { schema: "engineering/evidence" }), { code: "REDACTION_FAILED" });
    assert.equal(fs.existsSync(path.join(repo, "out")), false, "nada escrito");
    assert.throws(() => publishJson(repo, "out/ev.json", evidence({ schemaVersion: 7 }), { schema: "engineering/evidence" }), { code: "REDACTION_FAILED" });
    assert.equal(fs.existsSync(path.join(repo, "out", "ev.json")), false);
    publishJson(repo, "out/ev.json", evidence(), { schema: "engineering/evidence" });
    assert.ok(fs.existsSync(path.join(repo, "out", "ev.json")));
    assert.deepEqual(fs.readdirSync(path.join(repo, "out")), ["ev.json"], "sin temporales");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function P_EVIDENCE() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "contracts", "valid", "evidence.deterministic.json"), "utf8"));
}

// --- T08.4 evidencia ------------------------------------------------------

test("T08.4 evidencia ligada a revisión/unidad/scope/config/catálogo/plataforma con vigencia", async () => {
  const repo = tmpRepo();
  try {
    const { report, evidence } = await P.run();
    assert.equal(evidence.length, 1);
    const ev = evidence[0];
    const env = P.envelopeOf(report);
    assert.equal(ev.id, env.evidence.id);
    assert.equal(Date.parse(ev.expiresAt) - Date.parse(ev.createdAt), 86400 * 1000, "vigencia = freshness del control");
    const rel = writeEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", evidence: ev });
    assert.ok(rel.startsWith(".kiritek/evidence/engineering/acme_web/search.input-rate/"));
    const expected = { revision: ev.revision, scopeHash: ev.scopeHash, configHash: ev.configHash, catalogDigest: ev.catalog.digest, unitId: ev.unitId, controlId: ev.control.id, controlVersion: ev.control.version };
    const now = () => Date.parse(P.NOW) + 1000;
    const fresh = readEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", unitId: ev.unitId, controlId: ev.control.id, expected, nowMs: now });
    assert.equal(fresh.entries[0].freshness, "fresh");
    assert.equal(fresh.entries[0].evidence.platformKey, "test-platform");
    for (const k of ["revision", "scopeHash", "configHash", "catalogDigest", "unitId"]) {
      const other = readEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", unitId: ev.unitId, controlId: ev.control.id, expected: { ...expected, [k]: "otro" }, nowMs: now });
      assert.equal(other.entries[0].freshness, "stale", k);
    }
    const later = readEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", unitId: ev.unitId, controlId: ev.control.id, expected, nowMs: () => Date.parse(P.NOW) + 2 * 86400 * 1000 });
    assert.equal(later.entries[0].freshness, "stale");
    fs.writeFileSync(path.join(repo, rel), "{ roto");
    const broken = readEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", unitId: ev.unitId, controlId: ev.control.id, expected, nowMs: now });
    assert.equal(broken.entries.length, 0);
    assert.equal(broken.diagnostics[0].code, "EVIDENCE_INVALID");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T08.4 directorio de evidencia que escapa vía symlink se rechaza", async () => {
  const repo = tmpRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-out-"));
  try {
    fs.mkdirSync(path.join(repo, ".kiritek"));
    fs.symlinkSync(outside, path.join(repo, ".kiritek", "evidence"));
    const { evidence } = await P.run();
    assert.throws(() => writeEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", evidence: evidence[0] }), { code: "PUBLISH_PATH_OUTSIDE_REPO" });
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// --- T08.5 canarios y barrido global ---------------------------------------

const CANARIES = FORBIDDEN_FIELDS.map((f) => `KCANARY-${f}-7f3a`);

test("T08.5 canarios en facts (zona libre) nunca llegan a reporte, evidencia ni cache", async () => {
  const repo = tmpRepo();
  const cacheRoot = path.join(repo, ".kiritek", "cache", "engineering");
  try {
    const facts = { scenario: "burst", requestsStarted: 4, maxAllowed: 1 };
    CANARIES.forEach((cn, i) => (facts[`campo${i}`] = cn));
    const env = P.environment();
    const cache = createObservationCache({ root: cacheRoot, clock: () => P.NOW, canaries: CANARIES });
    const { report, evidence } = await evaluateRun({
      ...env,
      controls: P.fakeControl({ observations: [P.burstObservation({ facts })] }),
      cache,
      canaries: CANARIES,
      repoRoot: repo,
      clock: () => P.NOW,
      platformKey: "test-platform",
    });
    const evDir = ".kiritek/evidence/engineering";
    for (const ev of evidence) writeEvidence({ repoRoot: repo, directory: evDir, evidence: ev, canaries: CANARIES });
    assert.ok(P.envelopeOf(report).diagnostics.some((d) => d.code === "CACHE_REDACTION_FAILED"), "la cache rechaza la entrada con canarios");
    const artifacts = { "report.json": JSON.stringify(report), ...readTree(path.join(repo, evDir)), ...readTree(cacheRoot) };
    assert.ok(Object.keys(artifacts).length >= 2);
    assert.deepEqual(sweepArtifacts(artifacts, { canaries: CANARIES }), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T08.5 canario por cada canal persistible bloquea la publicación", async () => {
  const cn = CANARIES[0];
  const channels = {
    reason: () => ({ decision: "warn", reason: `fallo ${cn}` }),
    remediation: (i) => ({ decision: "warn", findings: [{ ruleId: "r", path: "apps/web/a.ts", severity: "low", fingerprint: "f", remediation: cn, evidenceClass: "deterministic", observationRefs: [i.observations[0].observationId] }] }),
    path: (i) => ({ decision: "warn", findings: [{ ruleId: "r", path: `apps/${cn}.ts`, severity: "low", fingerprint: "f", evidenceClass: "deterministic", observationRefs: [i.observations[0].observationId] }] }),
    ruleId: (i) => ({ decision: "warn", findings: [{ ruleId: cn, path: "apps/web/a.ts", severity: "low", fingerprint: "f", evidenceClass: "deterministic", observationRefs: [i.observations[0].observationId] }] }),
    fingerprint: (i) => ({ decision: "warn", findings: [{ ruleId: "r", path: "apps/web/a.ts", severity: "low", fingerprint: cn, evidenceClass: "deterministic", observationRefs: [i.observations[0].observationId] }] }),
  };
  for (const [channel, evaluate] of Object.entries(channels)) {
    const env = P.environment();
    await assert.rejects(
      evaluateRun({ ...env, controls: P.fakeControl({ evaluator: { version: "1.0.0", evaluate } }), canaries: CANARIES, clock: () => P.NOW, platformKey: "t" }),
      (err) => err.code === "REDACTION_FAILED" && !err.message.includes(cn),
      channel
    );
  }
  const env = P.environment();
  await assert.rejects(
    evaluateRun({ ...env, controls: P.fakeControl({ applicability: () => ({ status: "not_applicable", confidence: "deterministic", reasons: [{ code: "X", message: cn }] }) }), canaries: CANARIES, clock: () => P.NOW, platformKey: "t" }),
    { code: "REDACTION_FAILED" },
    "razón de aplicabilidad"
  );
});

test("T08.5 claves prohibidas emitidas por collector/evaluator no se filtran", async () => {
  for (const field of ["query", "payload", "prompt", "deviceToken", "email", "diff", "toolInput"]) {
    const cn = `KCANARY-${field}-7f3a`;
    const viaCollector = await P.run({ control: { observations: [P.burstObservation({ facts: { scenario: "x", requestsStarted: 1, maxAllowed: 1, [field]: cn } })] } });
    assert.equal(JSON.stringify(viaCollector.report).includes(cn), false, `collector ${field}`);
    assert.equal(P.envelopeOf(viaCollector.report).state, "unavailable");
    const viaEvaluator = await P.run({ control: { evaluator: { version: "1.0.0", evaluate: () => ({ decision: "warn", reason: "r", findings: [{ ruleId: "r", path: "a", severity: "low", fingerprint: "f", evidenceClass: "heuristic", [field]: cn }] }) } } });
    assert.equal(JSON.stringify(viaEvaluator.report).includes(cn), false, `evaluator ${field}`);
  }
});

test("T08.5 barrido de stdout/stderr de herramientas con canarios", () => {
  const hits = sweepArtifacts({ stdout: `ok ${CANARIES[3]}`, stderr: "sin datos" }, { canaries: CANARIES });
  assert.deepEqual(hits, [{ artifact: "stdout", kind: "canary" }]);
});
