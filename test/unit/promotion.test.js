"use strict";

/**
 * Tarea 33 — `security doctor` y promoción warning → enforce.
 *
 * Cubre: paridad de alcance/detector byte a byte entre modos (33.2), baseline
 * temporal por fingerprint con bloqueo de hallazgos nuevos y re-bloqueo al
 * expirar (33.4), readiness exitoso/fallido/no-verificable (33.1), registro de
 * promoción con actor/origen/config/evidencia y aviso de expiraciones (33.3).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const promotion = require("../../src/policy/promotion.js");
const engine = require("../../src/policy/engine.js");
const { buildFingerprint } = require("../../src/scanners/fingerprint.js");
const { findCanaries } = require("../../src/scanners/redactor.js");

// Un canario sintético con forma de credencial que el detector de contenido
// reconoce; nunca debe aparecer en la salida.
const SYNTH = "AKIAZZPROMOTIONCANARY00";

// ===================== 33.2 — paridad de alcance byte a byte =====================

test("verifyScopeParity: scope/detector idénticos entre modos; sólo cambia la decisión (warn→deny)", () => {
  const files = [{ path: ".env", content: `AWS_SECRET=${SYNTH}\n` }];
  const parity = promotion.verifyScopeParity({ event: "staged", files });

  assert.equal(parity.identical, true);
  assert.equal(parity.decisionWarning, "warn");
  assert.equal(parity.decisionEnforce, "deny");
  // Los findings serializados (sin la decisión) deben ser byte-idénticos.
  assert.equal(parity.warningFindingsJson, parity.enforceFindingsJson);
  assert.equal(parity.scopeWarning, parity.scopeEnforce);
});

test("verifyScopeParity: input limpio → allow en ambos modos, idénticos", () => {
  const files = [{ path: ".env.example", content: "AWS_SECRET=YOUR_SECRET_HERE\n" }];
  const parity = promotion.verifyScopeParity({ event: "staged", files });
  assert.equal(parity.identical, true);
  assert.equal(parity.decisionWarning, "allow");
  assert.equal(parity.decisionEnforce, "allow");
});

// ===================== 33.4 — baseline temporal =====================

test("normalizeBaselineEntry: exige fingerprint/owner/justificación/expiración", () => {
  const bad = promotion.normalizeBaselineEntry({ fingerprint: "fp" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 1);

  const good = promotion.normalizeBaselineEntry({
    fingerprint: "fp",
    owner: "sec@acme",
    justification: "deuda legacy conocida",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(good.valid, true);
});

test("baseline tolera un fingerprint legacy pero un hallazgo NUEVO sigue bloqueando (enforce)", () => {
  // Dos hallazgos: uno legacy (en baseline) y uno nuevo (no listado).
  const legacyPath = ".env";
  const newPath = "config/credentials.json";
  const legacyFp = buildFingerprint({ path: legacyPath, ruleId: "env-file" });

  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const baseline = [
    { fingerprint: legacyFp, owner: "sec@acme", justification: "deuda legacy", expiresAt: future },
  ];

  const files = [
    { path: legacyPath, content: `AWS_SECRET=${SYNTH}\n` },
    { path: newPath, content: "{}" },
  ];

  const be = promotion.evaluateWithBaseline({ files, baseline });
  // El legacy quedó tolerado; el nuevo bloquea.
  assert.equal(be.decision, "deny");
  assert.ok(be.tolerated.some((t) => t.fingerprint === legacyFp));
  assert.ok(be.blocking.some((b) => b.path === newPath));
});

test("baseline EXPIRADA re-bloquea el hallazgo legacy (enforce)", () => {
  const legacyPath = ".env";
  const legacyFp = buildFingerprint({ path: legacyPath, ruleId: "env-file" });
  const past = new Date(Date.now() - 86400000).toISOString();
  const baseline = [
    { fingerprint: legacyFp, owner: "sec@acme", justification: "deuda legacy", expiresAt: past },
  ];
  const files = [{ path: legacyPath, content: `AWS_SECRET=${SYNTH}\n` }];

  const be = promotion.evaluateWithBaseline({ files, baseline });
  // Expirada: ya no cubre → el hallazgo vuelve a disparar deny.
  assert.equal(be.decision, "deny");
  assert.ok(be.blocking.some((b) => b.fingerprint === legacyFp));
  assert.equal(be.tolerated.length, 0);
});

test("baseline que cubre TODOS los hallazgos → allow en enforce (deuda tolerada y acotada)", () => {
  const legacyPath = ".env";
  const legacyFp = buildFingerprint({ path: legacyPath, ruleId: "env-file" });
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const baseline = [
    { fingerprint: legacyFp, owner: "sec@acme", justification: "deuda legacy", expiresAt: future },
  ];
  const files = [{ path: legacyPath, content: `AWS_SECRET=${SYNTH}\n` }];
  const be = promotion.evaluateWithBaseline({ files, baseline });
  assert.equal(be.decision, "allow");
  assert.equal(be.blocking.length, 0);
});

test("classifyBaseline: separa activas, expiradas, inválidas y por expirar", () => {
  const now = () => Date.parse("2025-01-15T00:00:00.000Z");
  const baseline = [
    { fingerprint: "a", owner: "o", justification: "j", expiresAt: "2025-01-20T00:00:00.000Z" }, // activa (por expirar)
    { fingerprint: "b", owner: "o", justification: "j", expiresAt: "2025-01-10T00:00:00.000Z" }, // expirada
    { fingerprint: "c" }, // inválida
    { fingerprint: "d", owner: "o", justification: "j", expiresAt: "2025-06-01T00:00:00.000Z" }, // activa lejana
  ];
  const c = promotion.classifyBaseline(baseline, { now, warnWithinDays: 14 });
  assert.equal(c.active.length, 2);
  assert.equal(c.expired.length, 1);
  assert.equal(c.invalid.length, 1);
  assert.equal(c.expiringSoon.length, 1);
  assert.equal(c.expiringSoon[0].fingerprint, "a");
});

// ===================== 33.1 — readiness (doctor) =====================

/** Audit falso: todas las capas aplicables OK. */
function auditAllOk() {
  return async () => ({
    schemaVersion: 1,
    generatedAt: "2025-01-01T00:00:00.000Z",
    capabilities: [
      { id: "config", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "secret-scanning", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "git-hooks", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "ci", applicable: true, installed: true, active: true, observation: "observed" },
      { id: "jira", applicable: false, reason: "deshabilitado" },
    ],
  });
}

/** Audit falso: una capa (hooks) falla. */
function auditHooksFail() {
  return async () => ({
    schemaVersion: 1,
    generatedAt: "2025-01-01T00:00:00.000Z",
    capabilities: [
      { id: "config", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "git-hooks", applicable: true, installed: false, active: false, reason: "hooks no instalados" },
    ],
  });
}

/** Audit falso: Jira no observable (unknown) y nada falla. */
function auditJiraUnknown() {
  return async () => ({
    schemaVersion: 1,
    generatedAt: "2025-01-01T00:00:00.000Z",
    capabilities: [
      { id: "config", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "git-hooks", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "jira", applicable: true, installed: true, configured: true, active: false, observation: "unknown" },
    ],
  });
}

test("doctor: readiness READY cuando todas las capas aplicables están OK", async () => {
  const d = await promotion.runDoctor("/tmp/x", { auditFn: auditAllOk() });
  assert.equal(d.readiness, "ready");
  assert.equal(d.blockers.length, 0);
});

test("doctor: readiness NOT-READY cuando una capa falla", async () => {
  const d = await promotion.runDoctor("/tmp/x", { auditFn: auditHooksFail() });
  assert.equal(d.readiness, "not-ready");
  assert.ok(d.blockers.some((b) => /git-hooks/.test(b)));
});

test("doctor: readiness UNKNOWN cuando Jira no es observable y nada falla", async () => {
  const d = await promotion.runDoctor("/tmp/x", { auditFn: auditJiraUnknown() });
  assert.equal(d.readiness, "unknown");
  assert.ok(d.unknown.includes("jira"));
});

test("doctor: un hallazgo NUEVO fuera de la baseline hace NOT-READY aunque las capas estén OK", async () => {
  const d = await promotion.runDoctor("/tmp/x", {
    auditFn: auditAllOk(),
    files: [{ path: ".env", content: `AWS_SECRET=${SYNTH}\n` }],
    baseline: [],
  });
  assert.equal(d.readiness, "not-ready");
  assert.ok(d.newFindings.blocking.length >= 1);
});

// ===================== 33.3 — canPromote + registro =====================

test("canPromote: READY permite; NOT-READY por falla real NO es overridable", () => {
  assert.equal(promotion.canPromote({ readiness: "ready" }).allowed, true);

  const nr = promotion.canPromote(
    { readiness: "not-ready" },
    { override: { actor: "lead@acme", reason: "forzar" } }
  );
  assert.equal(nr.allowed, false);
});

test("canPromote: UNKNOWN sólo con override gobernado explícito (actor + razón)", () => {
  assert.equal(promotion.canPromote({ readiness: "unknown" }).allowed, false);
  const ok = promotion.canPromote(
    { readiness: "unknown" },
    { override: { actor: "lead@acme", reason: "entorno sin red para observar Jira" } }
  );
  assert.equal(ok.allowed, true);
  assert.equal(ok.overridden, true);
});

test("buildPromotionRecord: registra actor/origen/fecha/config anterior-nueva y evidencia", () => {
  const built = promotion.buildPromotionRecord(
    {
      actor: "lead@acme",
      origin: "cli",
      previousConfig: { version: 1, mode: "warning" },
      doctor: { readiness: "ready", baseline: { active: 1, expiringSoon: [] } },
    },
    { clock: () => "2025-01-01T00:00:00.000Z", toolVersion: "9.9.9" }
  );
  assert.equal(built.record.actor, "lead@acme");
  assert.equal(built.record.origin, "cli");
  assert.equal(built.record.previousMode, "warning");
  assert.equal(built.record.newMode, "enforce");
  assert.equal(built.record.date, "2025-01-01T00:00:00.000Z");
  assert.ok(built.evidence.id);
  assert.equal(built.evidence.decision, "allow");
  assert.equal(built.record.evidenceRef, built.evidence.id);
});

// ===================== No filtración =====================

test("ninguna salida de promotion filtra el canario", () => {
  const files = [{ path: ".env", content: `AWS_SECRET=${SYNTH}\n` }];
  const parity = promotion.verifyScopeParity({ event: "staged", files });
  const be = promotion.evaluateWithBaseline({ files, baseline: [] });
  const blob = JSON.stringify({ parity, be });
  assert.equal(findCanaries(blob).length, 0);
  assert.ok(!blob.includes(SYNTH));
});
