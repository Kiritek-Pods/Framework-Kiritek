"use strict";

// T01.6 (gate): ningún allow de un dominio prueba conformidad del otro; pack
// ausente no rompe auditoría security. Incluye la red de seguridad del
// envelope: un deny sólo se construye si el predicado §9.2 se cumple.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const securityResult = require("../../../src/domain/result.js");
const { runCapabilityAudit } = require("../../../src/audit/capabilities.js");
const contracts = require("../../../src/engineering/guardrails/contracts/index.js");
const { valid, envelopeInput } = require("../helpers/fixtures.js");

const env = contracts.resultEnvelope;
const { provesConformity, aggregateDomains, DOMAIN_STATUS } = contracts.domain;

function securityEntry(decision = "allow") {
  const input = { controlId: "secrets.gitleaks", decision, toolStatus: "ok" };
  if (decision !== "allow") input.reason = "hallazgo";
  return { domain: "security", result: securityResult.createResult(input) };
}

function verifiedEngineeringAllow() {
  const e = envelopeInput();
  e.level = "warn";
  e.result = { ...e.result, decision: "allow", severity: "info", findings: [] };
  delete e.result.reason;
  e.findingEvidence = [];
  return env.createResultEnvelope(e);
}

// --- Separación de dominios -------------------------------------------

test("T01.6 allow engineering verificado no prueba conformidad security (ni viceversa)", () => {
  const eng = verifiedEngineeringAllow();
  assert.equal(env.isVerifiedConformity(eng), true);
  assert.equal(provesConformity(eng, "engineering"), true);
  assert.equal(provesConformity(eng, "security"), false);

  const sec = securityEntry("allow");
  assert.equal(provesConformity(sec, "security"), true);
  assert.equal(provesConformity(sec, "engineering"), false);
});

test("T01.6 un envelope no puede declararse de dominio security", () => {
  const e = envelopeInput();
  e.domain = "security";
  assert.throws(() => env.createResultEnvelope(e), { code: "DOMAIN_MISMATCH" });
  const p = envelopeInput();
  p.packId = "core/security";
  assert.throws(() => env.createResultEnvelope(p), { code: "DOMAIN_MISMATCH" });
});

test("T01.6 agregado multidominio conserva cada dominio y no expone booleano global", () => {
  const agg = aggregateDomains({
    security: { installed: true, entries: [securityEntry("allow")] },
    engineering: { installed: true, entries: [env.parseResultEnvelope(valid("envelope.deny-eligible"))] },
  });
  assert.equal(agg.domains.security.status, "allow");
  assert.equal(agg.domains.engineering.status, "deny");
  assert.equal(agg.domains.engineering.entries[0].blockingEligible, true);
  for (const key of ["ok", "passed", "compliant", "allow", "status"]) {
    assert.equal(key in agg, false, `sin campo global "${key}"`);
  }
});

test("T01.6 pack engineering ausente: security no se marca fallido", () => {
  const agg = aggregateDomains({ security: { installed: true, entries: [securityEntry("allow")] } });
  assert.equal(agg.domains.engineering.status, DOMAIN_STATUS.NOT_INSTALLED);
  assert.equal(agg.domains.engineering.installed, false);
  assert.equal(agg.domains.security.status, "allow");
  const disabled = aggregateDomains({ security: { installed: true, entries: [securityEntry("allow")] }, engineering: { installed: false } });
  assert.equal(disabled.domains.security.status, "allow");
});

test("T01.6 pack security ausente: engineering no se marca fallido", () => {
  const agg = aggregateDomains({ engineering: { installed: true, entries: [verifiedEngineeringAllow()] } });
  assert.equal(agg.domains.security.status, DOMAIN_STATUS.NOT_INSTALLED);
  assert.equal(agg.domains.engineering.status, "allow");
});

test("T01.6 mezclar resultados de un dominio en el otro es un error", () => {
  assert.throws(
    () => aggregateDomains({ security: { installed: true, entries: [verifiedEngineeringAllow()] } }),
    { code: "DOMAIN_MISMATCH" }
  );
  assert.throws(
    () => aggregateDomains({ engineering: { installed: true, entries: [securityEntry()] } }),
    { code: "DOMAIN_MISMATCH" }
  );
});

test("T01.6 abstenciones engineering cuentan como unverified, nunca como allow", () => {
  const na = env.parseResultEnvelope(valid("envelope.not-applicable"));
  const agg = aggregateDomains({ engineering: { installed: true, entries: [na] } });
  assert.equal(agg.domains.engineering.status, DOMAIN_STATUS.UNVERIFIED);
  assert.equal(provesConformity(na, "engineering"), false);
});

test("T01.6 auditoría security idéntica con o sin artefactos engineering en el repo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-sep-"));
  try {
    const deps = { now: () => "2026-10-01T12:00:00.000Z", toolCacheRoot: path.join(tmp, ".tool-cache") };
    const without = runCapabilityAudit(tmp, deps);
    fs.writeFileSync(path.join(tmp, "kiritek-engineering.config.json"), JSON.stringify({ schemaVersion: 1 }));
    fs.mkdirSync(path.join(tmp, ".kiritek", "engineering"), { recursive: true });
    const withEng = runCapabilityAudit(tmp, deps);
    assert.deepEqual(withEng, without);
    assert.equal(/engineering/.test(JSON.stringify(without)), false, "la auditoría security no depende del pack engineering");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("T01.6 código security no importa el dominio engineering", () => {
  const srcRoot = path.join(__dirname, "..", "..", "..", "src");
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(srcRoot, "engineering")) walk(full);
      } else if (entry.name.endsWith(".js") && /require\([^)]*engineering/.test(fs.readFileSync(full, "utf8"))) {
        offenders.push(path.relative(srcRoot, full));
      }
    }
  })(srcRoot);
  assert.deepEqual(offenders, []);
});

// --- Elegibilidad de bloqueo (red de seguridad del contrato) -----------

test("gate: envelope determinista, fresco, atribuible y enforce es elegible", () => {
  const e = env.createResultEnvelope(envelopeInput());
  assert.equal(e.blockingEligible, true);
  assert.deepEqual(env.denyEligibilityViolations(e), []);
});

test("gate: blockingEligible es derivado; no puede aportarse ni falsificarse", () => {
  const forged = envelopeInput();
  forged.blockingEligible = true;
  assert.throws(() => env.createResultEnvelope(forged), { code: "DERIVED_FIELD" });

  const mismatch = valid("envelope.deny-eligible");
  mismatch.blockingEligible = false;
  assert.throws(() => env.parseResultEnvelope(mismatch), { code: "DERIVED_FIELD" });

  const na = valid("envelope.not-applicable");
  na.blockingEligible = true;
  assert.throws(() => env.parseResultEnvelope(na), { code: "DERIVED_FIELD" });
});

/** Cada mutación rompe exactamente una condición de §9.2. */
const BREAKERS = {
  "level warn": (e) => { e.level = "warn"; },
  "evidencia heurística": (e) => { e.evidenceClass = "heuristic"; e.confidence = "low"; },
  "evidencia manual": (e) => { e.evidenceClass = "manual"; e.confidence = "high"; },
  "evidencia stale": (e) => { e.evidenceFreshness = "stale"; },
  "evidencia en conflicto": (e) => { e.evidenceFreshness = "conflict"; },
  "revisión distinta": (e) => { e.evidence.revision = "fedcba9876543210fedcba9876543210fedcba98"; },
  "scope distinto": (e) => { e.evidence.scopeHash = `sha256:${"f".repeat(64)}`; },
  "config distinta": (e) => { e.evidence.configHash = `sha256:${"f".repeat(64)}`; },
  "catálogo distinto (cache con hash distinto)": (e) => { e.evidence.catalogDigest = `sha256:${"f".repeat(64)}`; },
  "unidad distinta": (e) => { e.evidence.unitId = "acme/other"; },
  "control distinto": (e) => { e.evidence.controlId = "web.module-announcement"; },
  "sin contrato de enforcement": (e) => { delete e.control.enforcementContractVersion; delete e.control.enforcementMoments; },
  "momento fuera del contrato de enforcement": (e) => { e.control.enforcementMoments = ["release"]; },
  "evidencia incompleta (parcial/timeout)": (e) => { e.evidenceCompleteness = "partial"; },
  "aplicabilidad no determinista": (e) => { e.applicability.confidence = "high"; },
  "aplicabilidad de otro alcance": (e) => { e.applicability.scopeHash = `sha256:${"f".repeat(64)}`; },
  "finding heurístico (regex/nombre/dependencia/AST parcial)": (e) => { e.findingEvidence[0].evidenceClass = "heuristic"; },
  "finding suprimido por waiver": (e) => {
    e.suppressed = [{ kind: "waiver", ref: "W-1", expiresAt: "2026-12-01T00:00:00Z", fingerprint: "fp-cadence-1" }];
    e.result.findings[0].status = "suppressed";
  },
};

for (const [label, breakIt] of Object.entries(BREAKERS)) {
  test(`gate: deny con "${label}" → DENY_NOT_ELIGIBLE; con warn se acepta y no es elegible`, () => {
    const deny = envelopeInput();
    breakIt(deny);
    assert.throws(() => env.createResultEnvelope(deny), (err) => err.code === "DENY_NOT_ELIGIBLE" && err.violations.length >= 1);

    const warn = envelopeInput();
    breakIt(warn);
    warn.result.decision = "warn";
    const built = env.createResultEnvelope(warn);
    assert.equal(built.blockingEligible, false);
  });
}

test("gate: barrido combinatorio — sólo una combinación de nivel/estado/evidencia/frescura admite deny", () => {
  const states = ["evaluated", "unknown", "unavailable", "timeout", "conflict", "stale"];
  const classes = ["deterministic", "heuristic", "manual"];
  const freshness = ["fresh", "stale", "conflict"];
  const appConfidence = ["deterministic", "high", "medium", "low"];
  const accepted = [];
  for (const level of ["warn", "enforce"]) {
    for (const state of states) {
      for (const evidenceClass of classes) {
        for (const fresh of freshness) {
          for (const ac of appConfidence) {
            const e = envelopeInput();
            Object.assign(e, { level, state, evidenceClass, evidenceFreshness: fresh });
            e.confidence = evidenceClass === "deterministic" ? "deterministic" : "medium";
            e.applicability.confidence = ac;
            if (state !== "evaluated") e.diagnostics = [{ code: "X", message: "x" }];
            try {
              env.createResultEnvelope(e);
              accepted.push([level, state, evidenceClass, fresh, ac].join("/"));
            } catch (err) {
              assert.ok(err instanceof TypeError, String(err));
            }
          }
        }
      }
    }
  }
  assert.deepEqual(accepted, ["enforce/evaluated/deterministic/fresh/deterministic"]);
});
