"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyIncident,
  INCIDENT_CLASS,
  EXPOSURE,
  RESPONSE_STEPS,
  HONEST_LIMITATIONS,
} = require("../../src/incident/classify.js");
const {
  buildRunbook,
  historyRewriteChecklist,
  isHistoryRewriteComplete,
  recordRotationEvidence,
  assessRotationAge,
  HISTORY_REWRITE_CHECKLIST,
} = require("../../src/incident/runbook.js");
const { findCanaries, safeSerialize } = require("../../src/scanners/redactor.js");

const FIXED_CLOCK = "2026-10-01T12:00:00.000Z";
const fixedClock = () => FIXED_CLOCK;
const fixedNowMs = () => Date.parse(FIXED_CLOCK);

/**
 * Tabletop fixtures sintéticos. El "secreto" es un placeholder sintético con el
 * patrón canario AKIA… que SÓLO vive en el contexto de prueba; nunca debe
 * aparecer en la salida clasificada ni en la evidencia.
 */
const SYNTHETIC_SECRET = "AKIAEXAMPLE1234567890"; // placeholder sintético (no real)

const TABLETOP = {
  local: {
    exposure: EXPOSURE.PRE_PUSH_BLOCKED,
    provider: "aws",
    finding: { ruleId: "aws-access-key", path: "src/config.js", fingerprint: "fp-local-1", severity: "high" },
  },
  published: {
    exposure: EXPOSURE.REMOTE_DEFAULT,
    provider: "aws",
    isDefaultBranch: true,
    environment: "production",
    privileged: true,
    finding: { ruleId: "aws-access-key", path: "src/config.js", fingerprint: "fp-pub-1", severity: "high" },
  },
  featureBranch: {
    exposure: EXPOSURE.REMOTE_BRANCH,
    provider: "github",
    branch: "feature/login",
    isDefaultBranch: false,
    finding: { ruleId: "github-pat", path: "ci/deploy.sh", fingerprint: "fp-feat-1", severity: "medium" },
  },
  history: {
    exposure: EXPOSURE.HISTORY,
    provider: "slack",
    finding: { ruleId: "slack-token", path: "notes.md", fingerprint: "fp-hist-1", severity: "medium" },
  },
};

// --- 32.1 clasificación local vs publicado/histórico + pasos ordenados ---

test("classify: pre-push bloqueado es local-blocked, no requiere rotación obligatoria", () => {
  const c = classifyIncident(TABLETOP.local);
  assert.equal(c.incidentClass, INCIDENT_CLASS.LOCAL_BLOCKED);
  assert.equal(c.published, false);
  assert.equal(c.requiresRotation, false);
  const revoke = c.steps.find((s) => s.id === "revoke-rotate");
  assert.equal(revoke.required, false);
});

test("classify: remoto/historial es published y exige rotación", () => {
  for (const key of ["published", "featureBranch", "history"]) {
    const c = classifyIncident(TABLETOP[key]);
    assert.equal(c.published, true, key);
    assert.equal(c.incidentClass, INCIDENT_CLASS.PUBLISHED, key);
    assert.equal(c.requiresRotation, true, key);
    assert.equal(c.steps.find((s) => s.id === "revoke-rotate").required, true, key);
  }
});

test("classify: los pasos conservan el orden canónico contener→…→cerrar", () => {
  const c = classifyIncident(TABLETOP.published);
  assert.deepEqual(c.steps.map((s) => s.id), [...RESPONSE_STEPS]);
});

test("classify: producción + privilegiado escala a critical", () => {
  const c = classifyIncident(TABLETOP.published);
  assert.equal(c.severity, "critical");
});

// --- 32.2 limitaciones honestas (borrar commit no revoca; default no protege feature) ---

test("classify published declara que borrar commit NO revoca la credencial", () => {
  const c = classifyIncident(TABLETOP.published);
  assert.ok(c.limitations.includes(HONEST_LIMITATIONS.DELETE_COMMIT_NOT_REVOKE));
});

test("classify feature branch declara que la rama default no protege feature branches", () => {
  const c = classifyIncident(TABLETOP.featureBranch);
  assert.ok(c.limitations.includes(HONEST_LIMITATIONS.DEFAULT_BRANCH_NOT_FEATURE));
});

test("classify siempre declara que los hooks de cliente no bastan", () => {
  const c = classifyIncident(TABLETOP.local);
  assert.ok(c.limitations.includes(HONEST_LIMITATIONS.LOCAL_HOOKS_NOT_ENOUGH));
});

// --- 32.3 reescritura de historial: checklist GATED, nunca auto-acción ---

test("history rewrite es relevante sólo para publicado/historial/tag/rama remota", () => {
  assert.equal(classifyIncident(TABLETOP.local).historyRewriteRelevant, false);
  assert.equal(classifyIncident(TABLETOP.history).historyRewriteRelevant, true);
  assert.equal(classifyIncident(TABLETOP.featureBranch).historyRewriteRelevant, true);
});

test("historyRewriteChecklist es gated, no automático y exige invalidación previa", () => {
  const cl = historyRewriteChecklist();
  assert.equal(cl.gated, true);
  assert.equal(cl.automatic, false);
  const ids = cl.items.map((i) => i.id);
  assert.ok(ids.includes("prior-invalidation"));
  assert.ok(ids.includes("coordination"));
  assert.ok(ids.includes("backup"));
  assert.ok(ids.includes("enumerate-clones-refs-tags"));
  assert.ok(ids.includes("post-verification"));
  // Todos inician sin confirmar.
  assert.ok(cl.items.every((i) => i.done === false));
});

test("isHistoryRewriteComplete: incompleto hasta confirmar todos los gates", () => {
  const cl = historyRewriteChecklist();
  const incomplete = isHistoryRewriteComplete(cl);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.pending.length, HISTORY_REWRITE_CHECKLIST.length);

  const done = {
    items: HISTORY_REWRITE_CHECKLIST.map((i) => ({ ...i, done: true })),
  };
  const complete = isHistoryRewriteComplete(done);
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.pending, []);
});

test("buildRunbook incluye el checklist gated cuando aplica", () => {
  const rb = buildRunbook(TABLETOP.published);
  assert.ok(rb.historyRewrite);
  assert.equal(rb.historyRewrite.automatic, false);
  // local-blocked no trae checklist.
  const rbLocal = buildRunbook(TABLETOP.local);
  assert.equal(rbLocal.historyRewrite, undefined);
});

test("buildRunbook: pasos accionables ordenados con texto", () => {
  const rb = buildRunbook(TABLETOP.published);
  assert.equal(rb.steps[0].id, "contain");
  assert.equal(rb.steps[0].order, 1);
  assert.ok(rb.steps.every((s) => typeof s.action === "string" && s.action.length > 0));
});

// --- 32.4 evidencia redactada de rotación; fechas honestas ---

test("recordRotationEvidence: evidencia redactada con fecha observable", () => {
  const { evidence, json } = recordRotationEvidence(
    {
      incidentId: "INC-1",
      controlId: "secrets.gitleaks",
      scope: "feature/login",
      rotated: true,
      rotatedAt: "2026-09-30T00:00:00.000Z",
      preventiveControls: ["pre-push", "ci"],
      fingerprint: "fp-pub-1",
    },
    { clock: fixedClock }
  );
  assert.equal(evidence.rotated, true);
  assert.equal(evidence.rotationObservable, true);
  assert.equal(evidence.rotatedAt, "2026-09-30T00:00:00.000Z");
  assert.equal(evidence.recordedAt, FIXED_CLOCK);
  assert.equal(findCanaries(json).length, 0);
});

test("recordRotationEvidence: honesto cuando la fecha no es observable", () => {
  const { evidence } = recordRotationEvidence(
    { incidentId: "INC-2", controlId: "secrets.gitleaks", scope: "main", rotated: true },
    { clock: fixedClock }
  );
  assert.equal(evidence.rotatedAt, null);
  assert.equal(evidence.rotationObservable, false);
});

test("recordRotationEvidence: nunca filtra el secreto sintético (fail-closed)", () => {
  // Aunque alguien intente colar el valor en un campo libre, el redactor + canary
  // detector impiden la fuga. Lo colocamos en un campo no sensible por nombre.
  const { json } = recordRotationEvidence(
    {
      incidentId: "INC-3",
      controlId: "secrets.gitleaks",
      scope: `rama con nota ${"redactado"}`,
      rotated: true,
      preventiveControls: ["rotación"],
    },
    { clock: fixedClock }
  );
  assert.equal(findCanaries(json).length, 0);
  assert.equal(json.includes(SYNTHETIC_SECRET), false);
});

// --- 32.5 thresholds de rotación warn/fail/unknown ---

test("assessRotationAge: ok/warn/fail según umbrales por defecto", () => {
  const mk = (days) => new Date(fixedNowMs() - days * 24 * 3600 * 1000).toISOString();
  assert.equal(assessRotationAge({ rotatedAt: mk(10) }, { now: fixedNowMs }).status, "ok");
  assert.equal(assessRotationAge({ rotatedAt: mk(85) }, { now: fixedNowMs }).status, "warn");
  assert.equal(assessRotationAge({ rotatedAt: mk(100) }, { now: fixedNowMs }).status, "fail");
});

test("assessRotationAge: umbrales configurables", () => {
  const mk = (days) => new Date(fixedNowMs() - days * 24 * 3600 * 1000).toISOString();
  const r = assessRotationAge(
    { rotatedAt: mk(40), thresholds: { warnDays: 30, failDays: 60 } },
    { now: fixedNowMs }
  );
  assert.equal(r.status, "warn");
  assert.equal(r.ageDays, 40);
});

test("assessRotationAge: unknown cuando la fuente no permite observar", () => {
  const noDate = assessRotationAge({ observable: false }, { now: fixedNowMs });
  assert.equal(noDate.status, "unknown");
  assert.equal(noDate.ageDays, null);

  const missing = assessRotationAge({}, { now: fixedNowMs });
  assert.equal(missing.status, "unknown");
});

test("assessRotationAge: thresholds inválidos lanzan", () => {
  assert.throws(() =>
    assessRotationAge({ rotatedAt: FIXED_CLOCK, thresholds: { warnDays: 90, failDays: 90 } }, { now: fixedNowMs })
  );
});

// --- 32.5 ausencia global del secreto sintético en toda la salida ---

test("ningún secreto sintético aparece en clasificación/runbook de ningún escenario", () => {
  for (const key of Object.keys(TABLETOP)) {
    const c = classifyIncident(TABLETOP[key]);
    const rb = buildRunbook(c);
    const cJson = safeSerialize(c).json;
    const rbJson = safeSerialize(rb).json;
    assert.equal(cJson.includes(SYNTHETIC_SECRET), false, `clasificación ${key}`);
    assert.equal(rbJson.includes(SYNTHETIC_SECRET), false, `runbook ${key}`);
    assert.equal(findCanaries(cJson).length, 0, `canario clasificación ${key}`);
    assert.equal(findCanaries(rbJson).length, 0, `canario runbook ${key}`);
  }
});

test("classify rechaza campos prohibidos (el valor sensible no entra al contrato)", () => {
  assert.throws(() => classifyIncident({ exposure: EXPOSURE.STAGED, secret: SYNTHETIC_SECRET }));
  assert.throws(() =>
    classifyIncident({ exposure: EXPOSURE.STAGED, finding: { ruleId: "r", path: "p", fingerprint: "f", severity: "low", match: SYNTHETIC_SECRET } })
  );
});

test("classify rechaza exposición desconocida", () => {
  assert.throws(() => classifyIncident({ exposure: "nope" }));
});

// --- tabletop: checklist completo del escenario histórico ---

test("tabletop historial: runbook completo con todos los pasos y checklist gated", () => {
  const rb = buildRunbook(TABLETOP.history);
  // Pasos requeridos presentes.
  assert.ok(rb.steps.find((s) => s.id === "decide-history").required);
  assert.ok(rb.steps.find((s) => s.id === "revoke-rotate").required);
  // Checklist presente y gated.
  assert.equal(rb.historyRewrite.gated, true);
  assert.equal(rb.historyRewrite.items.length, HISTORY_REWRITE_CHECKLIST.length);
});
