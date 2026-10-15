"use strict";

// T13.1–T13.4: gobierno de waivers y N/A (validación, carga y matching).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateException, loadExceptions } = require("../../../src/engineering/guardrails/exceptions/index.js");
const { findGovernedNA, applyWaivers } = require("../../../src/engineering/guardrails/pipeline/exceptions.js");
const P = require("../helpers/pipeline.js");

const NOW = "2026-10-05T12:00:00Z";
const POLICY = { maxWaiverDays: 90, maxNaReviewDays: 365, requireDistinctApprover: true, naApproval: "high-criticality" };
const CTX = {
  nowIso: NOW,
  policy: POLICY,
  units: new Map([["acme/web", { root: "apps/web" }]]),
  controls: new Map([["search.input-rate", { version: "1.0.0" }]]),
  fileExists: (rel) => rel === "apps/web/docs/search-local.md",
};

function waiver(over = {}) {
  return {
    schemaVersion: 1,
    kind: "waiver",
    id: "W-2026-001",
    controlId: "search.input-rate",
    controlVersion: "1.0.0",
    unitId: "acme/web",
    target: { ruleId: "search.input-rate/cadence" },
    scope: { paths: ["apps/web/src/search/**"] },
    owner: "team-web",
    reason: "Migración del buscador en curso; debounce llega en el sprint 42.",
    ticket: "WEB-1234",
    approver: "eng-leads",
    createdAt: "2026-10-01T00:00:00Z",
    expiresAt: "2026-11-15T00:00:00Z",
    ...over,
  };
}

function governedNa(over = {}) {
  return {
    schemaVersion: 1,
    kind: "governed-na",
    id: "NA-search-local",
    controlId: "search.input-rate",
    unitId: "acme/web",
    scope: { paths: ["apps/web/**"] },
    functionalReason: "Búsqueda local sobre ≤ 200 elementos en memoria; sin trabajo remoto.",
    owner: "team-web",
    evidenceRef: "apps/web/docs/search-local.md",
    createdAt: "2026-10-01T00:00:00Z",
    reviewAt: "2027-04-01T00:00:00Z",
    ...over,
  };
}

const errorsOf = (doc, ctx = CTX) => validateException(doc, ctx).errors;

// --- T13.1 campos obligatorios ---------------------------------------------

test("T13.1 waiver completo es válido y se normaliza sin razón/owner/ticket", () => {
  const v = validateException(waiver(), CTX);
  assert.equal(v.status, "valid");
  assert.deepEqual(v.record, {
    id: "W-2026-001",
    kind: "waiver",
    unitId: "acme/web",
    controlId: "search.input-rate",
    controlVersion: "1.0.0",
    ruleId: "search.input-rate/cadence",
    paths: ["apps/web/src/search/**"],
    expiresAt: "2026-11-15T00:00:00Z",
  });
  for (const field of ["controlId", "controlVersion", "unitId", "target", "scope", "owner", "reason", "ticket", "approver", "createdAt", "expiresAt"]) {
    const doc = waiver();
    delete doc[field];
    assert.deepEqual(errorsOf(doc), ["SCHEMA_INVALID"], field);
  }
  assert.deepEqual(errorsOf(waiver({ target: { fingerprint: "fp-1" } })), []);
  assert.deepEqual(errorsOf(waiver({ scope: { scopeHash: `sha256:${"a".repeat(64)}` } })), []);
});

// --- T13.2 N/A vs waiver ---------------------------------------------------

test("T13.2 N/A no finge finding pero exige prueba de no aplicabilidad y revisión", () => {
  const v = validateException(governedNa(), CTX);
  assert.equal(v.status, "valid");
  assert.equal(v.record.expiresAt, "2027-04-01T00:00:00Z", "reviewAt es el vencimiento del N/A");
  assert.equal(v.record.fingerprint, undefined);
  assert.deepEqual(errorsOf(governedNa({ evidenceRef: "apps/web/docs/no-existe.md" })), ["NA_EVIDENCE_MISSING"]);
  for (const field of ["functionalReason", "evidenceRef", "reviewAt", "owner", "scope"]) {
    const doc = governedNa();
    delete doc[field];
    assert.deepEqual(errorsOf(doc), ["SCHEMA_INVALID"], field);
  }
  assert.deepEqual(errorsOf(governedNa({ target: { ruleId: "search.input-rate/cadence" } })), ["SCHEMA_INVALID"], "un N/A no apunta a findings");
  assert.deepEqual(errorsOf({ ...governedNa(), kind: "otro" }), ["KIND_UNKNOWN"]);
});

// --- T13.3 abusos ----------------------------------------------------------

test("T13.3 rechaza comodines globales y alcance fuera de la unidad", () => {
  for (const paths of [["**"], ["*"], ["**/*"], ["apps/**"], ["apps/docs/**"]]) {
    assert.deepEqual(errorsOf(waiver({ scope: { paths } })), ["GLOBAL_SCOPE"], paths[0]);
  }
  assert.deepEqual(errorsOf(waiver({ target: { fingerprint: "*" } })), ["SCHEMA_INVALID"]);
  assert.deepEqual(errorsOf(waiver({ target: { ruleId: "search.input-rate/*" } })), ["SCHEMA_INVALID"]);
  assert.deepEqual(errorsOf(waiver({ unitId: "*" })), ["SCHEMA_INVALID"]);
  assert.deepEqual(errorsOf(waiver({ target: { ruleId: "app.minimum-supported-version/grace" } })), ["RULE_OUTSIDE_CONTROL"]);
  assert.deepEqual(errorsOf(waiver({ unitId: "acme/otra" })), ["UNKNOWN_UNIT"]);
  assert.deepEqual(errorsOf(waiver({ controlId: "web.no-existe", target: { ruleId: "web.no-existe/x" } })), ["UNKNOWN_CONTROL"]);
});

test("T13.3 rechaza autoaprobación y N/A crítico sin aprobador", () => {
  assert.deepEqual(errorsOf(waiver({ approver: "team-web" })), ["SELF_APPROVAL"]);
  assert.deepEqual(errorsOf(waiver({ approver: "team-web" }), { ...CTX, policy: { ...POLICY, requireDistinctApprover: false } }), []);
  assert.deepEqual(errorsOf(governedNa({ criticality: "high" })), ["APPROVER_REQUIRED"]);
  assert.deepEqual(errorsOf(governedNa({ criticality: "high", approver: "eng-leads" })), []);
  assert.deepEqual(errorsOf(governedNa(), { ...CTX, policy: { ...POLICY, naApproval: "always" } }), ["APPROVER_REQUIRED"]);
  assert.deepEqual(errorsOf(governedNa({ approver: "team-web" })), ["SELF_APPROVAL"]);
});

test("T13.3 rechaza expiraciones invertidas, excesivas y creación futura", () => {
  assert.deepEqual(errorsOf(waiver({ expiresAt: "2026-09-01T00:00:00Z" })), ["EXPIRY_NOT_AFTER_CREATION"]);
  assert.deepEqual(errorsOf(waiver({ expiresAt: "2027-01-15T00:00:00Z" })), ["EXPIRY_EXCESSIVE"], "> 90 días");
  assert.deepEqual(errorsOf(waiver({ expiresAt: "2027-01-15T00:00:00Z" }), { ...CTX, policy: { ...POLICY, maxWaiverDays: 180 } }), []);
  assert.deepEqual(errorsOf(governedNa({ reviewAt: "2028-01-01T00:00:00Z" })), ["EXPIRY_EXCESSIVE"], "> 365 días");
  assert.deepEqual(errorsOf(waiver({ createdAt: "2026-10-20T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" })), ["CREATED_IN_FUTURE"]);
});

test("T13.4 vencido no es inválido: se carga como `expired` para reactivar con diagnóstico", () => {
  const v = validateException(waiver({ createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-09-01T00:00:00Z" }), CTX);
  assert.equal(v.status, "expired");
  assert.ok(v.record);
});

// --- Carga desde archivos ---------------------------------------------------

test("T13 loader: un registro por archivo; rechazos con códigos y sin contenido sensible", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-exc-")));
  try {
    const write = (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), typeof content === "string" ? content : JSON.stringify(content));
    };
    write("apps/web/docs/search-local.md", "# medición\n");
    write(".kiritek/engineering/waivers/ok.json", waiver());
    write(".kiritek/engineering/waivers/dup.json", waiver({ reason: "Duplicado del mismo id, debe rechazarse." }));
    write(".kiritek/engineering/waivers/broken.json", "{ roto");
    write(".kiritek/engineering/waivers/self.json", waiver({ id: "W-self", approver: "team-web" }));
    write(".kiritek/engineering/waivers/na-here.json", governedNa({ id: "NA-misplaced" }));
    write(".kiritek/engineering/not-applicable/search.json", governedNa());
    const env = P.environment();
    const out = loadExceptions({ repoRoot: repo, resolvedConfig: env.resolvedConfig, catalogSnapshot: env.catalogSnapshot, nowIso: NOW });
    assert.deepEqual(out.records.map((r) => r.id).sort(), ["NA-search-local", "W-2026-001"]);
    // Orden de archivo estable: dup.json se carga antes que ok.json.
    assert.deepEqual(out.rejected.map((r) => [r.file, r.errors.join(",")]), [
      [".kiritek/engineering/waivers/broken.json", "PARSE_ERROR"],
      [".kiritek/engineering/waivers/na-here.json", "KIND_MISMATCH"],
      [".kiritek/engineering/waivers/ok.json", "DUPLICATE_ID"],
      [".kiritek/engineering/waivers/self.json", "SELF_APPROVAL"],
    ]);
    assert.ok(!JSON.stringify(out).includes("sprint 42"), "la razón no viaja");
    assert.ok(!JSON.stringify(out).includes("WEB-1234"), "el ticket no viaja");
    assert.deepEqual(out.diagnostics.map((d) => d.code), ["EXCEPTIONS_REJECTED"]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Matching (pipeline) ------------------------------------------------------

const MCTX = { unitId: "acme/web", controlId: "search.input-rate", controlVersion: "1.0.0", scopeHash: `sha256:${"1".repeat(64)}`, scopePaths: ["apps/web/src/search/box.ts"], unitOwns: ["apps/web/**"], nowMs: Date.parse(NOW) };
const finding = (over = {}) => ({ ruleId: "search.input-rate/cadence", path: "apps/web/src/search/box.ts", severity: "high", fingerprint: "fp-1", evidenceClass: "deterministic", ...over });
const rec = (doc) => validateException(doc, CTX).record;

test("T13.3/T13.4 waiver por condición: suprime con deuda; cambio de path, versión o fingerprint lo reactiva", () => {
  const w = rec(waiver());
  const hit = applyWaivers([finding(), finding({ fingerprint: "fp-2" })], [w], MCTX);
  assert.deepEqual(hit.findings.map((f) => f.status), ["suppressed", "suppressed"]);
  assert.deepEqual(hit.suppressed.map((s) => s.fingerprint), ["fp-1", "fp-2"]);

  const moved = applyWaivers([finding({ path: "apps/web/src/other/box.ts" })], [w], MCTX);
  assert.equal(moved.findings[0].status, undefined);
  assert.deepEqual(moved.reactivated, [{ kind: "waiver", ref: "W-2026-001", code: "WAIVER_SCOPE_CHANGED" }]);

  const bumped = applyWaivers([finding()], [w], { ...MCTX, controlVersion: "1.1.0" });
  assert.deepEqual(bumped.reactivated.map((r) => r.code), ["WAIVER_CONTROL_CHANGED"]);

  const byFp = rec(waiver({ target: { fingerprint: "fp-1" } }));
  const changed = applyWaivers([finding({ fingerprint: "fp-1b" })], [byFp], MCTX);
  assert.equal(changed.suppressed.length, 0, "otro fingerprint ⇒ el waiver no se reutiliza");

  const expired = applyWaivers([finding()], [{ ...w, expiresAt: "2026-10-01T00:00:00Z" }], MCTX);
  assert.deepEqual(expired.reactivated.map((r) => r.code), ["WAIVER_EXPIRED"]);
  const otherUnit = applyWaivers([finding()], [w], { ...MCTX, unitId: "acme/docs" });
  assert.equal(otherUnit.suppressed.length, 0);
});

test("T13.4 N/A: cambio fuera de su alcance o evaluación completa no cubierta ⇒ reactivación", () => {
  const na = rec(governedNa());
  assert.equal(findGovernedNA([na], MCTX).record.id, "NA-search-local");
  const narrow = rec(governedNa({ scope: { paths: ["apps/web/src/search/**"] } }));
  assert.equal(findGovernedNA([narrow], MCTX).record.id, "NA-search-local");
  const outside = findGovernedNA([narrow], { ...MCTX, scopePaths: ["apps/web/src/search/box.ts", "apps/web/src/cart.ts"] });
  assert.equal(outside.record, null);
  assert.deepEqual(outside.reactivated, [{ kind: "governed-na", ref: "NA-search-local", code: "GOVERNED_NA_SCOPE_CHANGED" }]);
  assert.equal(findGovernedNA([narrow], { ...MCTX, scopePaths: [] }).record, null, "evaluación completa: el N/A parcial no cubre la unidad");
  assert.equal(findGovernedNA([na], { ...MCTX, scopePaths: [] }).record.id, "NA-search-local");
  const versioned = rec(governedNa({ controlVersion: "0.9.0" }));
  assert.deepEqual(findGovernedNA([versioned], MCTX).reactivated.map((r) => r.code), ["GOVERNED_NA_CONTROL_CHANGED"]);
});

test("T13.4 reporte: deuda, próximo vencimiento y eventos; sin razón/owner/ticket/aprobador", async () => {
  const fp = `fp-obs/${P.COLLECTOR}/0`;
  const exceptions = [
    { id: "W-1", kind: "waiver", unitId: "acme/web", controlId: P.CONTROL, fingerprint: fp, expiresAt: "2026-11-01T00:00:00Z" },
    { id: "W-old", kind: "waiver", unitId: "acme/web", controlId: P.CONTROL, fingerprint: "fp-otro", expiresAt: "2026-10-01T00:00:00Z" },
  ];
  const { report } = await P.run({ exceptions: { records: exceptions, rejected: [{ file: ".kiritek/engineering/waivers/x.json", kind: "waiver", errors: ["SELF_APPROVAL"] }], diagnostics: [] } });
  assert.deepEqual(report.exceptions.applied, [{ kind: "waiver", ref: "W-1", unitId: "acme/web", controlId: P.CONTROL, expiresAt: "2026-11-01T00:00:00Z", findings: 1 }]);
  assert.deepEqual(report.exceptions.debt, { waivers: 1, suppressedFindings: 1, notApplicable: 0 });
  assert.equal(report.exceptions.nextExpiry, "2026-11-01T00:00:00Z");
  assert.deepEqual(report.exceptions.rejected.map((r) => r.errors), [["SELF_APPROVAL"]]);
  assert.deepEqual(report.events.filter((e) => e.type.startsWith("exception-")).map((e) => `${e.type}:${e.ref}`), ["exception-applied:W-1"]);
  assert.equal(P.envelopeOf(report).result.decision, "warn", "suprimido ⇒ deuda, nunca allow limpio");
  assert.equal(report.outcome.policyDeny, false);
});
