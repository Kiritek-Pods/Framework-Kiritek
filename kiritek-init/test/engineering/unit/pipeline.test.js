"use strict";

// T06.1–T06.9: orquestador, pipeline compartido y validación negativa.

const test = require("node:test");
const assert = require("node:assert/strict");

const P = require("../helpers/pipeline.js");
const { normalizeObservations } = require("../../../src/engineering/guardrails/pipeline/normalize.js");
const { runCollectors } = require("../../../src/engineering/guardrails/pipeline/collect.js");

const { CONTROL, burstObservation, fakeControl, run, envelopeOf, environment } = P;

function noDeny(report, label) {
  for (const e of report.results) {
    assert.notEqual(e.result && e.result.decision, "deny", `${label}: ${e.unit.id}/${e.control.id} no debe ser deny`);
  }
  assert.equal(report.outcome.policyDeny, false, `${label}: sin policy deny`);
}

// --- T06.1 flujo único ---------------------------------------------------

test("T06.1 flujo completo: deny elegible sólo con enforce + evidencia determinista en pr", async () => {
  let adapted = null;
  const { report } = await run({ adapter: (r) => (adapted = r.outcome.decision) });
  const e = envelopeOf(report);
  assert.equal(e.state, "evaluated");
  assert.equal(e.result.decision, "deny");
  assert.equal(e.blockingEligible, true);
  assert.equal(e.evidenceClass, "deterministic");
  assert.equal(e.evidenceFreshness, "fresh");
  assert.equal(e.evidence.scopeHash, e.scopeHash);
  assert.deepEqual(report.outcome.blockingResults, [{ unitId: "acme/web", controlId: CONTROL }]);
  assert.equal(report.outcome.exitCodeHint, 1);
  assert.equal(adapted, "deny", "el adapter recibe el reporte final");
});

test("T06.1 cada par unidad×control tiene envelope explícito; nada se omite", async () => {
  const { report } = await run();
  assert.equal(report.results.length, 2 * 3);
  const docs = report.results.filter((e) => e.unit.id === "acme/docs");
  assert.ok(docs.every((e) => e.state === "not_evaluated" && e.diagnostics.some((d) => d.code === "NOT_IN_SCOPE")));
  // Perfil no declarado ⇒ not_applicable aunque el control no esté implementado (R5.3).
  const noProfile = envelopeOf(report, "acme/web", "web.module-announcement");
  assert.equal(noProfile.state, "not_applicable");
  assert.ok(noProfile.diagnostics.some((d) => d.code === "PROFILE_NOT_DECLARED"));
  assert.equal(envelopeOf(report, "acme/web", "app.minimum-supported-version").state, "not_applicable");
  // Perfil declarado pero sin implementación ⇒ unavailable con fallback operativo.
  const withProfile = await run({ webProfiles: ["web", "search", "module-launch"] });
  const notImpl = envelopeOf(withProfile.report, "acme/web", "web.module-announcement");
  assert.equal(notImpl.state, "unavailable");
  assert.ok(notImpl.diagnostics.some((d) => d.code === "CONTROL_NOT_IMPLEMENTED"));
  assert.equal(notImpl.result.decision, "error", "fallback de pr: error operativo");
});

test("T06.1 nivel off se registra como off y no ejecuta collectors", async () => {
  let called = 0;
  const { report } = await run({ level: "off", control: { collect: () => { called += 1; return [burstObservation()]; } } });
  assert.equal(envelopeOf(report).state, "off");
  assert.equal(called, 0);
});

test("T06.1 fallback por momento: agent difiere (sin payload), pr da error operativo", async () => {
  const failing = { collect: () => { throw new Error("boom con /Users/secreto"); } };
  const agent = await run({ moment: "agent", control: failing });
  assert.equal(envelopeOf(agent.report).state, "unavailable");
  assert.equal(envelopeOf(agent.report).result, null);
  const pr = await run({ control: failing });
  assert.equal(envelopeOf(pr.report).result.decision, "error");
  assert.equal(JSON.stringify(pr.report).includes("/Users/secreto"), false, "no se propaga el mensaje del collector");
});

// --- T06.2 aislamiento ---------------------------------------------------

test("T06.2 collectors reciben contexto congelado sin nivel ni decisiones", async () => {
  let seen;
  await run({ control: { collect: (ctx) => { seen = ctx; return [burstObservation()]; } } });
  assert.ok(Object.isFrozen(seen) && Object.isFrozen(seen.scope));
  assert.equal("level" in seen, false);
  assert.deepEqual(Object.keys(seen).sort(), ["budgetMs", "controlId", "moment", "parameters", "repoRoot", "scope", "unit"]);
});

test("T06.2 collector que emite decisión produce observación inválida, no decisión", async () => {
  const { report } = await run({ control: { observations: [{ ...burstObservation(), decision: "deny" }] } });
  const e = envelopeOf(report);
  assert.equal(e.state, "unavailable");
  assert.ok(e.diagnostics.some((d) => d.code === "COLLECTOR_DECISION"));
  noDeny(report, "collector con decisión");
});

test("T06.2 evaluator no determinista, que muta su entrada, asíncrono o que lanza ⇒ error operativo", async () => {
  let n = 0;
  const cases = {
    EVALUATOR_NONDETERMINISTIC: { version: "1.0.0", evaluate: () => ({ decision: (n += 1) % 2 ? "deny" : "allow", reason: "x" }) },
    EVALUATOR_ERROR: { version: "1.0.0", evaluate: (input) => { input.observations.push({}); return { decision: "allow" }; } },
    EVALUATOR_NOT_PURE: { version: "1.0.0", evaluate: async () => ({ decision: "deny", reason: "x" }) },
    EVALUATOR_OUTPUT_INVALID: { version: "1.0.0", evaluate: () => ({ decision: "deny", blockingEligible: true, reason: "x" }) },
  };
  for (const [code, evaluator] of Object.entries(cases)) {
    const { report } = await run({ control: { evaluator } });
    const e = envelopeOf(report);
    assert.equal(e.result.decision, "error", code);
    assert.ok(e.diagnostics.some((d) => d.code === code), code);
    assert.equal(report.outcome.policyDeny, false);
  }
});

test("T06.2 evaluator recibe reloj inyectado como valor y entrada congelada", async () => {
  let input;
  await run({ control: { evaluator: { version: "1.0.0", evaluate: (i) => { input = i; return { decision: "allow" }; } } } });
  assert.equal(input.clockRef, P.NOW);
  assert.ok(Object.isFrozen(input));
  assert.equal(JSON.stringify(input).includes("/Users/"), false, "sin rutas absolutas");
});

// --- T06.3 normalización -------------------------------------------------

const IDENTITY = {
  controlId: CONTROL,
  unitId: "acme/web",
  revision: P.HEAD,
  scopeHash: `sha256:${"b".repeat(64)}`,
  configHash: `sha256:${"c".repeat(64)}`,
  catalogDigest: `sha256:${"a".repeat(64)}`,
  observedAt: P.NOW,
};

test("T06.3 normaliza con identidad de la ejecución, procedencia y limitaciones", () => {
  const { observations } = normalizeObservations(
    [{ collectorId: P.COLLECTOR, version: "1.0.0", status: "ok", durationMs: 5, raw: [burstObservation(), { ...burstObservation(), status: "partial", confidence: "medium", limitations: [{ code: "TIMEOUT", message: "escenario 3" }] }] }],
    IDENTITY,
    { maxAgeSeconds: 3600, nowMs: () => Date.parse(P.NOW) }
  );
  assert.equal(observations.length, 2);
  for (const k of ["revision", "scopeHash", "configHash", "catalogDigest"]) assert.equal(observations[0][k], IDENTITY[k]);
  assert.deepEqual(observations[0].source, { collectorId: P.COLLECTOR, version: "1.0.0", mechanism: "test" });
  assert.equal(observations[1].status, "partial");
  assert.equal(observations[1].limitations[0].code, "TIMEOUT");
});

test("T06.3 cache con otra identidad o vencida no sustenta decisiones", () => {
  const { observations, staleIds } = normalizeObservations(
    [{ collectorId: P.COLLECTOR, version: "1.0.0", status: "ok", durationMs: 0, raw: [
      burstObservation({ cache: "hit", configHash: `sha256:${"f".repeat(64)}` }),
      burstObservation({ cache: "hit", observedAt: "2026-09-01T00:00:00Z" }),
    ] }],
    IDENTITY,
    { maxAgeSeconds: 86400, nowMs: () => Date.parse(P.NOW) }
  );
  assert.equal(observations[0].status, "invalid");
  assert.equal(observations[0].limitations[0].code, "IDENTITY_MISMATCH");
  assert.notEqual(observations[0].confidence, "deterministic");
  assert.deepEqual(staleIds, [observations[1].observationId]);
});

test("T06.3 el orden de los collectors no altera las observaciones", async () => {
  const mk = (id) => ({ id, version: "1.0.0", collect: () => [burstObservation({ facts: { scenario: id, requestsStarted: 1, maxAllowed: 1 } })] });
  const a = await runCollectors([mk("x/a"), mk("x/b")], {}, { timeoutMs: 1000 });
  const b = await runCollectors([mk("x/b"), mk("x/a")], {}, { timeoutMs: 1000 });
  const norm = (col) => normalizeObservations(col.map((x) => ({ ...x, durationMs: 0 })), IDENTITY, {}).observations;
  assert.deepEqual(norm(a), norm(b));
});

// --- T06.4 aplicabilidad -------------------------------------------------

test("T06.4 sin perfil declarado: not_applicable y no se recolecta", async () => {
  let called = 0;
  const { report } = await run({ webProfiles: ["web"], level: "warn", control: { collect: () => { called += 1; return [burstObservation()]; } } });
  const e = envelopeOf(report);
  assert.equal(e.state, "not_applicable");
  assert.ok(e.diagnostics.some((d) => d.code === "PROFILE_NOT_DECLARED"));
  assert.equal(called, 0);
});

test("T06.4 perfil sólo sugerido ⇒ unknown (abstención)", async () => {
  const { report } = await run({ webProfiles: ["web"], level: "warn", suggestions: [{ unitId: "acme/web", profile: { id: "search" } }] });
  const e = envelopeOf(report);
  assert.equal(e.state, "unknown");
  assert.ok(e.diagnostics.some((d) => d.code === "PROFILE_SUGGESTED_ONLY"));
});

test("T06.4 hook de aplicabilidad: not_applicable, unavailable, unknown y excepción ⇒ abstención", async () => {
  const verdicts = {
    not_applicable: () => ({ status: "not_applicable", confidence: "deterministic", reasons: [{ code: "LOCAL_SEARCH", message: "búsqueda local" }] }),
    unavailable: () => ({ status: "unavailable", confidence: "unknown", reasons: [{ code: "NO_CONTRACT", message: "sin contrato" }] }),
    unknown: () => ({ status: "applicable", confidence: "unknown", reasons: [] }),
    throws: () => { throw new Error("x"); },
  };
  const expected = { not_applicable: "not_applicable", unavailable: "unavailable", unknown: "unknown", throws: "unknown" };
  for (const [k, hook] of Object.entries(verdicts)) {
    const { report } = await run({ control: { applicability: hook } });
    assert.equal(envelopeOf(report).state, expected[k], k);
    noDeny(report, k);
  }
});

// --- T06.5 / T06.6 compuerta ---------------------------------------------

test("T06.5/6 deny en warn se degrada a warn con DENY_NOT_ELIGIBLE y evento auditable", async () => {
  const { report } = await run({ level: "warn" });
  const e = envelopeOf(report);
  assert.equal(e.result.decision, "warn");
  assert.equal(e.blockingEligible, false);
  assert.ok(e.diagnostics.some((d) => d.code === "DENY_NOT_ELIGIBLE" && /level != enforce/.test(d.message)));
  assert.deepEqual(report.events.map((ev) => [ev.type, ev.unitId, ev.controlId, ev.degradedTo]), [["deny-not-eligible", "acme/web", CONTROL, "warn"]]);
});

test("T06.5/6 momento fuera del contrato de enforcement (pre-commit/agent) nunca bloquea", async () => {
  for (const moment of ["pre-commit", "agent"]) {
    const { report } = await run({ moment });
    const e = envelopeOf(report);
    assert.equal(e.result.decision, "warn", moment);
    assert.ok(e.diagnostics.some((d) => d.code === "DENY_NOT_ELIGIBLE" && /fuera del contrato/.test(d.message)), moment);
  }
});

// --- T06.7 deterministas vs heurísticos ----------------------------------

test("T06.7 findings mixtos: sólo el determinista bloquea; el heurístico declara incertidumbre", async () => {
  const evaluator = {
    version: "1.0.0",
    evaluate(input) {
      const o = input.observations[0];
      return {
        decision: "deny",
        findings: [
          { ruleId: `${CONTROL}/cadence`, path: "apps/web/search.ts", severity: "high", fingerprint: "fp-det", evidenceClass: "deterministic", observationRefs: [o.observationId] },
          { ruleId: `${CONTROL}/handler-name`, path: "apps/web/search.ts", severity: "low", fingerprint: "fp-heur", evidenceClass: "heuristic" },
        ],
      };
    },
  };
  const { report } = await run({ control: { evaluator } });
  const e = envelopeOf(report);
  assert.equal(e.result.decision, "deny");
  assert.equal(e.blockingEligible, true);
  assert.deepEqual(e.findingEvidence, [{ fingerprint: "fp-det", evidenceClass: "deterministic" }, { fingerprint: "fp-heur", evidenceClass: "heuristic" }]);
  assert.match(e.result.findings.find((f) => f.fingerprint === "fp-heur").remediation, /heurística/);
});

test("T06.7 finding 'determinista' sin respaldo se reclasifica y no bloquea", async () => {
  const liar = { version: "1.0.0", evaluate: () => ({ decision: "deny", findings: [{ ruleId: "r", path: "apps/web/a.ts", severity: "high", fingerprint: "fp", evidenceClass: "deterministic" }] }) };
  const { report } = await run({ control: { evaluator: liar } });
  const e = envelopeOf(report);
  assert.equal(e.result.decision, "warn");
  assert.ok(e.diagnostics.some((d) => d.code === "FINDING_RECLASSIFIED"));
  assert.ok(e.diagnostics.some((d) => d.code === "DENY_NOT_ELIGIBLE"));
});

// --- T06.8 agregación ----------------------------------------------------

test("T06.8 error operativo nunca se presenta como policy deny", async () => {
  const { report } = await run({ control: { collect: () => { throw new Error("x"); } } });
  assert.equal(report.outcome.policyDeny, false);
  assert.equal(report.outcome.operationalError, true);
  assert.equal(report.outcome.decision, "error");
  assert.equal(report.outcome.exitCodeHint, 3);
  for (const e of report.results) {
    assert.equal(e.domain, "engineering");
    assert.ok(e.unit.id && e.control.id);
  }
  for (const k of ["compliant", "conformant", "ok", "passed"]) assert.equal(k in report.outcome, false);
});

test("T06.8 waiver vigente suprime con deuda (warn), expirado reactiva", async () => {
  const fp = `fp-obs/${P.COLLECTOR}/0`;
  const waiver = { id: "W-1", kind: "waiver", unitId: "acme/web", controlId: CONTROL, fingerprint: fp, expiresAt: "2026-12-01T00:00:00Z" };
  const active = await run({ exceptions: [waiver] });
  const e = envelopeOf(active.report);
  assert.equal(e.result.decision, "warn");
  assert.deepEqual(e.suppressed.map((s) => s.ref), ["W-1"]);
  assert.equal(e.result.findings[0].status, "suppressed");
  const expired = await run({ exceptions: [{ ...waiver, expiresAt: "2026-10-01T00:00:00Z" }] });
  assert.equal(envelopeOf(expired.report).result.decision, "deny");
  assert.ok(envelopeOf(expired.report).diagnostics.some((d) => d.code === "WAIVER_EXPIRED"));
  const otherScope = await run({ exceptions: [{ ...waiver, scopeHash: `sha256:${"9".repeat(64)}` }] });
  assert.equal(envelopeOf(otherScope.report).result.decision, "deny");
});

test("T06.8 N/A gobernado vigente: not_applicable con referencia, sin evaluar", async () => {
  let called = 0;
  const na = { id: "NA-1", kind: "governed-na", unitId: "acme/web", controlId: CONTROL, expiresAt: "2026-12-01T00:00:00Z" };
  const { report } = await run({ exceptions: [na], control: { collect: () => { called += 1; return [burstObservation()]; } } });
  const e = envelopeOf(report);
  assert.equal(e.state, "not_applicable");
  assert.deepEqual(e.suppressed, [{ kind: "governed-na", ref: "NA-1", expiresAt: "2026-12-01T00:00:00Z" }]);
  assert.equal(called, 0);
});

test("T06.8 privacidad: rutas y URLs se sanean; PII o credenciales bloquean la publicación", async () => {
  const leaky = (reason) => ({ version: "1.0.0", evaluate: () => ({ decision: "warn", reason }) });
  const { report } = await run({ control: { evaluator: leaky("falló en /Users/alguien/repo con https://u:p@api.example.invalid/x?token=1") } });
  const text = JSON.stringify(report);
  assert.equal(text.includes("/Users/alguien"), false);
  assert.equal(text.includes("u:p@"), false);
  assert.equal(text.includes("token=1"), false);
  for (const reason of ["contacto ana@example.com", "clave ghp_" + "A".repeat(36), "tarjeta 4111 1111 1111 1111"]) {
    await assert.rejects(run({ control: { evaluator: leaky(reason) } }), (err) => err.code === "REDACTION_FAILED" && !err.message.includes(reason.split(" ")[1]));
  }
});

// --- T06.9 validación negativa obligatoria -------------------------------

const NEGATIVE = {
  "regex/nombres": { observations: [burstObservation({ mechanism: "static-analysis", evidenceClass: "heuristic", confidence: "low" })] },
  "presencia de dependencia": { observations: [burstObservation({ mechanism: "manifest", evidenceClass: "heuristic", confidence: "medium" })] },
  "AST parcial": { observations: [burstObservation({ mechanism: "static-analysis", status: "partial", evidenceClass: "heuristic", confidence: "low", limitations: [{ code: "AST_PARTIAL", message: "parse parcial" }] })] },
  "evidencia manual no autorizada": {
    observations: [burstObservation({
      mechanism: "manual",
      evidenceClass: "manual",
      confidence: "high",
      facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1, review: { reviewer: "qa", scope: "acme/web", checklistRef: "docs/check.md", reviewedAt: "2026-10-04T00:00:00Z", expiresAt: "2026-10-11T00:00:00Z", reference: "QA-1" } },
    })],
  },
  timeout: { collect: () => new Promise(() => {}) },
  parcial: { observations: [burstObservation({ status: "partial", confidence: "medium", limitations: [{ code: "PARTIAL", message: "2 de 7 escenarios" }] })] },
  stale: { observations: [burstObservation({ cache: "hit", observedAt: "2026-09-01T00:00:00Z" })] },
  conflict: { observations: [burstObservation({ status: "conflict", confidence: "high", limitations: [{ code: "CONTRADICTION", message: "dos suites discrepan" }] })] },
  "cache con hash distinto": { observations: [burstObservation({ cache: "hit", catalogDigest: `sha256:${"0".repeat(64)}` })] },
  unavailable: { collect: () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); } },
  "aplicabilidad ambigua": { applicability: () => ({ status: "applicable", confidence: "unknown", reasons: [] }) },
};

for (const [label, control] of Object.entries(NEGATIVE)) {
  test(`T06.9 ${label} jamás produce deny (enforce + evaluator que siempre niega)`, async () => {
    const env = environment();
    const alwaysDeny = {
      version: "1.0.0",
      evaluate: (input) => ({
        decision: "deny",
        findings: input.observations.map((o) => ({ ruleId: "r", path: "apps/web/a.ts", severity: "high", fingerprint: `fp-${o.observationId}`, evidenceClass: "deterministic", observationRefs: [o.observationId] })),
        reason: "siempre deny",
      }),
    };
    const controls = fakeControl({ evaluator: alwaysDeny, ...control });
    // El caso timeout usa un presupuesto corto para no esperar 10 minutos.
    const { report } = await (label === "timeout" ? runWithBudget(env, controls, 50) : run({ env, controls }));
    noDeny(report, label);
    assert.equal(envelopeOf(report).blockingEligible, false, label);
  });
}

/** Ejecuta con presupuesto de pr reducido (simula collector colgado). */
async function runWithBudget(env, controls, budgetMs) {
  const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
  const effective = JSON.parse(JSON.stringify(env.resolvedConfig.effective));
  effective.execution.budgetsMs.pr = budgetMs;
  const resolvedConfig = { ...env.resolvedConfig, effective };
  return evaluateRun({ ...env, resolvedConfig, controls, clock: () => P.NOW, platformKey: "test-platform" });
}

test("T06.9 timeout queda como estado timeout con fallback operativo", async () => {
  const env = environment();
  const controls = fakeControl({ collect: () => new Promise(() => {}) });
  const { report } = await runWithBudget(env, controls, 30);
  const e = envelopeOf(report);
  assert.equal(e.state, "timeout");
  assert.equal(e.result.decision, "error");
  assert.ok(e.diagnostics.some((d) => d.code === "TIMEOUT"));
});
