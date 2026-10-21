"use strict";

// T06.10 (gate): mayDeny sólo es true con nivel enforce + aplicabilidad y
// evidencia deterministas fresh + hashes/revisión/unidad coincidentes +
// contrato aprobado + sin conflicto/waiver. Se comprueba contra un predicado
// de referencia escrito aparte, a nivel de contrato y de orquestador.

const test = require("node:test");
const assert = require("node:assert/strict");

const env = require("../../../src/engineering/guardrails/contracts/result-envelope.js");
const { envelopeInput } = require("../helpers/fixtures.js");
const P = require("../helpers/pipeline.js");

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const OTHER = `sha256:${"f".repeat(64)}`;

/** Predicado de referencia (independiente de la implementación). */
function reference(e) {
  const ev = e.evidence;
  const classes = Object.fromEntries(e.findingEvidence.map((f) => [f.fingerprint, f.evidenceClass]));
  const waived = new Set(e.suppressed.map((s) => s.fingerprint));
  const blocking = (e.result ? e.result.findings : []).filter((f) => f.status !== "suppressed" && !waived.has(f.fingerprint) && classes[f.fingerprint] === "deterministic");
  return (
    e.level === "enforce" &&
    e.state === "evaluated" &&
    e.applicability.status === "applicable" &&
    e.applicability.confidence === "deterministic" &&
    e.applicability.scopeHash === e.scopeHash &&
    e.evidenceClass === "deterministic" &&
    e.evidenceFreshness === "fresh" &&
    !!ev &&
    ev.revision === e.revision &&
    ev.scopeHash === e.scopeHash &&
    ev.configHash === e.configHash &&
    ev.catalogDigest === e.catalog.digest &&
    ev.unitId === e.unit.id &&
    ev.controlId === e.control.id &&
    e.control.enforcementContractVersion !== undefined &&
    (e.control.enforcementMoments || []).includes(e.moment) &&
    e.evidenceCompleteness === "complete" &&
    blocking.length > 0
  );
}

function randomDraft(rand) {
  const e = envelopeInput();
  e.level = pick(rand, ["warn", "enforce", "enforce"]);
  e.applicability.confidence = pick(rand, ["deterministic", "deterministic", "high", "medium", "low"]);
  if (rand() < 0.1) e.applicability.scopeHash = OTHER;
  e.evidenceClass = pick(rand, ["deterministic", "deterministic", "heuristic", "manual"]);
  e.confidence = e.evidenceClass === "deterministic" ? "deterministic" : "medium";
  e.evidenceFreshness = pick(rand, ["fresh", "fresh", "stale", "conflict"]);
  if (rand() < 0.1) {
    e.evidence = null;
    e.evidenceCompleteness = "none";
    e.evidenceFreshness = "missing";
    e.evidenceClass = "none";
    e.confidence = "unknown";
  } else {
    if (rand() < 0.1) e.evidence.revision = "fedcba9876543210fedcba9876543210fedcba98";
    for (const k of ["scopeHash", "configHash", "catalogDigest"]) if (rand() < 0.08) e.evidence[k] = OTHER;
    if (rand() < 0.08) e.evidence.unitId = "acme/other";
    if (rand() < 0.08) e.evidence.controlId = "web.module-announcement";
  }
  if (rand() < 0.15) {
    delete e.control.enforcementContractVersion;
    delete e.control.enforcementMoments;
  } else if (rand() < 0.1) {
    e.control.enforcementMoments = ["release"];
  }
  if (e.evidence && rand() < 0.1) e.evidenceCompleteness = "partial";
  const n = 1 + Math.floor(rand() * 3);
  const base = e.result.findings[0];
  e.result.findings = [];
  e.findingEvidence = [];
  e.suppressed = [];
  for (let i = 0; i < n; i += 1) {
    const fp = `fp-${i}`;
    const waived = rand() < 0.2;
    e.result.findings.push({ ...base, fingerprint: fp, status: waived ? "suppressed" : "new" });
    e.findingEvidence.push({ fingerprint: fp, evidenceClass: pick(rand, ["deterministic", "deterministic", "heuristic"]) });
    if (waived) e.suppressed.push({ kind: "waiver", ref: `W-${i}`, expiresAt: "2026-12-01T00:00:00Z", fingerprint: fp });
  }
  return e;
}

test("T06.10 property (contrato): blockingEligible ≡ predicado de referencia (5000 casos)", () => {
  const rand = prng(20261005);
  let eligible = 0;
  for (let i = 0; i < 5000; i += 1) {
    const draft = randomDraft(rand);
    const asWarn = JSON.parse(JSON.stringify(draft));
    asWarn.result.decision = "warn";
    const built = env.createResultEnvelope(asWarn);
    const want = reference(built);
    assert.equal(built.blockingEligible, want, `caso ${i}: ${env.denyEligibilityViolations(built).join("; ")}`);
    const asDeny = JSON.parse(JSON.stringify(draft));
    asDeny.result.decision = "deny";
    if (want) {
      assert.equal(env.createResultEnvelope(asDeny).blockingEligible, true);
      eligible += 1;
    } else {
      assert.throws(() => env.createResultEnvelope(asDeny), { code: "DENY_NOT_ELIGIBLE" }, `caso ${i}`);
    }
  }
  assert.ok(eligible > 50 && eligible < 4900, `cobertura de ambos lados (${eligible} elegibles)`);
});

function randomObservation(rand) {
  const kind = pick(rand, ["det", "det", "det", "heur", "partial", "cache-mismatch", "stale"]);
  const base = P.burstObservation();
  switch (kind) {
    case "heur":
      return { kind, raw: { ...base, mechanism: "static-analysis", evidenceClass: "heuristic", confidence: pick(rand, ["low", "medium"]) } };
    case "partial":
      return { kind, raw: { ...base, status: "partial", confidence: "medium", limitations: [{ code: "PARTIAL", message: "parcial" }] } };
    case "cache-mismatch":
      return { kind, raw: { ...base, cache: "hit", configHash: `sha256:${"e".repeat(64)}` } };
    case "stale":
      return { kind, raw: { ...base, cache: "hit", observedAt: "2026-09-01T00:00:00Z" } };
    default:
      return { kind, raw: base };
  }
}

test("T06.10 property (orquestador): todo deny emitido cumple todas las condiciones, y viceversa", async () => {
  const rand = prng(7);
  const alwaysDeny = {
    version: "1.0.0",
    evaluate: (input) => ({
      decision: "deny",
      findings: input.observations.map((o) => ({ ruleId: "r", path: "apps/web/a.ts", severity: "high", fingerprint: `fp-${o.observationId}`, evidenceClass: "deterministic", observationRefs: [o.observationId] })),
      reason: "siempre deny",
    }),
  };
  let denies = 0;
  for (let i = 0; i < 120; i += 1) {
    const level = pick(rand, ["warn", "enforce", "enforce"]);
    const moment = pick(rand, ["pr", "pr", "release", "pre-commit", "agent"]);
    const obs = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => randomObservation(rand));
    const waive = rand() < 0.15;
    const exceptions = waive
      ? obs.map((_, j) => ({ id: `W-${j}`, kind: "waiver", unitId: "acme/web", controlId: P.CONTROL, fingerprint: `fp-obs/${P.COLLECTOR}/${j}`, expiresAt: "2026-12-01T00:00:00Z" }))
      : undefined;
    const { report } = await P.run({ level, moment, exceptions, control: { observations: obs.map((o) => o.raw), evaluator: alwaysDeny } });
    const e = P.envelopeOf(report);
    const allDeterministicFresh = obs.every((o) => o.kind === "det");
    const expectDeny = level === "enforce" && ["pr", "release"].includes(moment) && allDeterministicFresh && !waive;
    const isDeny = !!e.result && e.result.decision === "deny";
    assert.equal(isDeny, expectDeny, `caso ${i}: level=${level} moment=${moment} obs=${obs.map((o) => o.kind)} waive=${waive} state=${e.state}`);
    if (isDeny) {
      denies += 1;
      assert.equal(e.blockingEligible, true);
      assert.equal(report.outcome.policyDeny, true);
    } else {
      assert.equal(report.outcome.policyDeny, false);
    }
  }
  assert.ok(denies > 5, `cobertura: ${denies} deny`);
});
