"use strict";

/**
 * Checkpoint Tarea 30 (CP) — Verificación consolidada de separación core/stack
 * y auditoría por capacidades. Gatea rollout/migración hasta que pasen G.7,
 * G.11 y G.12.
 *
 * A diferencia de las suites puntuales de las tareas 27/28/29 (que validan cada
 * pieza por separado), este checkpoint DEMUESTRA las tres propiedades del gate
 * juntas, en un solo lugar, incluyendo la pieza que ninguna suite previa cubría
 * de forma explícita: el espectro COMPLETO de exit codes de la auditoría
 * profunda — 0 (sano) / 1 (degradado) / 3 (desconocido-que-importa) — para
 * demostrar coherencia, no sólo los caminos degradados.
 *
 *   30.1 / G.7  — el control genérico de secretos NO vive en Flutter (vive en el
 *                 Gitleaks core; M1 delega) y OWASP móvil (M2/M5/M9) sigue
 *                 operativo y redactado.
 *   30.2 / G.11 — la auditoría profunda distingue capas y estados, nunca infiere
 *                 cumplimiento por existencia, y produce exit codes coherentes
 *                 0/1/3 en estado sano y en degradaciones representativas por capa.
 *   30.3 / G.12 — las plantillas no solicitan datos sensibles y toda afirmación
 *                 "verificada" exige evidencia vigente; ninguna salida filtra el
 *                 canario sintético.
 *
 * No hay red real ni secretos reales: sólo marcadores sintéticos.
 *
 * (Requisitos 11–14, 18, 26, G.7, G.11–G.12.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cap = require("../../src/audit/capabilities.js");
const report = require("../../src/audit/report.js");
const checks = require("../../src/audit/checks.js");
const mobile = require("../../src/scanners/mobile-adapter.js");
const result = require("../../src/domain/result.js");
const { findCanaries } = require("../../src/scanners/redactor.js");
const { createEvidence } = require("../../src/domain/evidence.js");
const {
  validateDeclaration,
} = require("../../src/policy/evidence-declaration.js");
const { lintTemplate, topLevelSections, ALLOWED_SECTIONS } = require("../../src/policy/template-lint.js");

const SYNTH_AWS = "AKIAIOSFODNN7EXAMPLE";
const FIXED_NOW = "2026-10-01T00:00:00.000Z";
const NOW_MS = () => Date.parse(FIXED_NOW);

const TPL_DIR = path.join(__dirname, "..", "..", "templates", "core", "security", "templates");

/**
 * Construye un conjunto de capacidades aplicables SANAS (todas ok), para
 * demostrar que la auditoría puede llegar a exit 0 cuando cada capa está
 * realmente verificada. Se usan las primitivas públicas de la auditoría
 * (`cap.capability`) para no depender de un repo completamente instalado.
 */
function healthyCapabilities() {
  return [
    cap.capability("config", true, {
      installed: true,
      integrity: cap.INTEGRITY.OK,
      configured: true,
      active: true,
      enforcement: cap.ENFORCEMENT.ENFORCE,
    }),
    cap.capability("secret-scanning", true, {
      installed: true,
      version: "8.18.4",
      integrity: cap.INTEGRITY.OK,
      configured: true,
      active: true,
    }),
    cap.capability("git-hooks", true, {
      installed: true,
      active: true,
      executable: true,
    }),
    // Flutter no aplicable (proyecto no Flutter) → no penaliza el exit code.
    cap.capability("mobile-owasp", false, {
      observation: cap.OBSERVATION.NOT_APPLICABLE,
    }),
    // Jira observado remotamente (probe 200) → ok.
    cap.capability("jira", true, {
      installed: true,
      configured: true,
      active: true,
      observation: cap.OBSERVATION.OBSERVED,
    }),
    // CI observado remotamente → ok.
    cap.capability("ci", true, {
      installed: true,
      configured: true,
      active: true,
      observation: cap.OBSERVATION.OBSERVED,
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 30.1 / G.7 — separación core/stack: secretos en el core; OWASP móvil operativo
// ─────────────────────────────────────────────────────────────────────────────

test("30.1/G.7: el adaptador móvil NO define ningún gate de secretos (vive en el core)", () => {
  const ids = Object.values(mobile.MOBILE_CONTROL_IDS).sort();
  assert.deepEqual(ids, [
    "mobile.flutter.dependencies",
    "mobile.flutter.network",
    "mobile.flutter.storage",
  ]);
  for (const id of ids) {
    assert.equal(/secret|gitleaks/i.test(id), false, `${id} no debe ser un gate de secretos`);
  }
});

test("30.1/G.7: OWASP móvil (M2/M5/M9) sigue operativo y bloquea HIGH en enforce, redactado", () => {
  // M5: hallazgo de red con una URL que embebe una credencial sintética.
  const { result: res } = mobile.adaptMobileReport({
    repoRoot: "/tmp/demo-flutter",
    control: "M5",
    isFlutter: true,
    mode: "enforce",
    report: {
      findings: [
        {
          file: "lib/main.dart",
          line: 2,
          issue: "HTTP URL (non-localhost)",
          code: `final url = "http://user:${SYNTH_AWS}@api.example.net?token=${SYNTH_AWS}";`,
          severity: "HIGH",
          recommendation: "Use HTTPS",
        },
      ],
    },
  });
  // Operativo: HIGH en enforce → deny.
  assert.equal(res.decision, result.DECISION.DENY);
  // Redactado: ni code/match en el Finding, ni canario en el JSON del resultado.
  const f = res.findings[0];
  assert.ok(!("code" in f) && !("match" in f));
  const serialized = JSON.stringify(res);
  assert.equal(serialized.includes(SYNTH_AWS), false);
  assert.deepEqual(findCanaries(serialized), []);
});

test("30.1/G.7: fuera de Flutter el control móvil es not_applicable (no 'fallido')", () => {
  const { result: res } = mobile.adaptMobileReport({
    repoRoot: "/tmp/web",
    control: "M9",
    isFlutter: false,
  });
  assert.equal(res.decision, result.DECISION.ALLOW);
  assert.equal(res.toolStatus, result.TOOL_STATUS.NOT_APPLICABLE);
});

test("30.1/G.7: la auditoría marca mobile-owasp not_applicable fuera de Flutter", () => {
  // Repo del propio paquete: no es Flutter.
  const pkgRoot = path.join(__dirname, "..", "..");
  const audit = cap.runCapabilityAudit(pkgRoot, { now: () => FIXED_NOW });
  const mob = audit.capabilities.find((c) => c.id === "mobile-owasp");
  assert.equal(mob.applicable, false);
  assert.equal(report.statusOf(mob), "not_applicable");
});

// ─────────────────────────────────────────────────────────────────────────────
// 30.2 / G.11 — matriz de exit codes 0/1/3 de la auditoría profunda
// ─────────────────────────────────────────────────────────────────────────────

test("30.2/G.11: estado SANO → todas las capas aplicables ok → exit 0", () => {
  const audit = { schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: healthyCapabilities() };
  const rendered = report.renderAudit(audit); // valida schema
  assert.equal(rendered.exitCode, 0, rendered.human);
  // Ninguna capa aplicable queda fuera de ok/not_applicable.
  for (const c of audit.capabilities) {
    const st = report.statusOf(c);
    assert.ok(st === "ok" || st === "not_applicable", `${c.id} → ${st}`);
  }
});

test("30.2/G.11: degradación por capa → exit 1 (fallo), honesto por capa", () => {
  // Partimos del estado sano y degradamos UNA capa distinta cada vez; cada
  // degradación representativa debe mover el exit a 1 (fallo), nunca a 0.
  const scenarios = [
    { id: "config", patch: { integrity: cap.INTEGRITY.FAILED }, expect: "failed" },
    { id: "git-hooks", patch: { installed: false, active: false }, expect: "missing" },
    { id: "secret-scanning", patch: { active: false }, expect: "degraded" },
    { id: "git-hooks", patch: { drift: true }, expect: "drift" },
    { id: "jira", patch: { observation: cap.OBSERVATION.UNAUTHORIZED }, expect: "failed" },
  ];
  for (const sc of scenarios) {
    const caps = healthyCapabilities().map((c) =>
      c.id === sc.id ? { ...c, ...sc.patch } : c
    );
    const audit = { schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: caps };
    const degraded = audit.capabilities.find((c) => c.id === sc.id);
    assert.equal(report.statusOf(degraded), sc.expect, `${sc.id}: ${sc.expect}`);
    assert.equal(report.exitCodeFor(audit), 1, `${sc.id}/${sc.expect} → exit 1`);
  }
});

test("30.2/G.11: desconocido-que-importa (sin fallos) → exit 3, nunca 0", () => {
  // Jira habilitado pero NO observado remotamente (unknown) y el resto sano:
  // no es un fallo, pero no se puede afirmar cumplimiento → exit 3.
  const caps = healthyCapabilities().map((c) =>
    c.id === "jira"
      ? { ...c, active: false, observation: cap.OBSERVATION.UNKNOWN }
      : c
  );
  const audit = { schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: caps };
  const jiraCap = audit.capabilities.find((c) => c.id === "jira");
  assert.equal(report.statusOf(jiraCap), "unknown");
  assert.equal(report.exitCodeFor(audit), 3);
});

test("30.2/G.11: fallo tiene precedencia sobre desconocido (1 gana a 3)", () => {
  const caps = healthyCapabilities().map((c) => {
    if (c.id === "jira") return { ...c, active: false, observation: cap.OBSERVATION.UNKNOWN };
    if (c.id === "config") return { ...c, integrity: cap.INTEGRITY.FAILED };
    return c;
  });
  const audit = { schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: caps };
  assert.equal(report.exitCodeFor(audit), 1);
});

test("30.2/G.11: NO se infiere cumplimiento por existencia — archivos presentes, evidencia expirada → degradado", () => {
  // Capa de scanning instalada+activa, pero con evidencia EXPIRADA: la mera
  // existencia del artefacto no sostiene `verified`; la capa queda degradada.
  const stale = createEvidence({
    control: "secret-scanning",
    command: "scan",
    toolVersion: "8.18.4",
    configHash: "cfg",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    createdAt: "2026-09-01T00:00:00.000Z", // 30 días antes de FIXED_NOW
  });
  const base = healthyCapabilities();
  const enriched = cap.enrichDeep(base, path.join(__dirname, "..", ".."), {
    now: FIXED_NOW,
    maxAgeHours: 24,
    evidenceByCapability: { "secret-scanning": stale },
  });
  const scanning = enriched.find((c) => c.id === "secret-scanning");
  assert.equal(scanning.lastResultFresh, false);
  assert.equal(report.statusOf(scanning), "degraded");
  const audit = { schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: enriched };
  assert.equal(report.exitCodeFor(audit), 1);
});

test("30.2/G.11: --deep self-check sintético dispara, no filtra, y la salida es schema-valid", () => {
  const base = healthyCapabilities();
  const enriched = cap.enrichDeep(base, path.join(__dirname, "..", ".."), {
    now: FIXED_NOW,
    deep: true,
  });
  const scanning = enriched.find((c) => c.id === "secret-scanning");
  assert.equal(scanning.selfCheck.ran, true);
  assert.equal(scanning.selfCheck.fired, true);
  assert.equal(scanning.selfCheck.leaked, false);
  const audit = { schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: enriched };
  const rendered = report.renderAudit(audit); // valida schema
  assert.equal(rendered.exitCode, 0);
  // El canario del self-check nunca aparece en el JSON de la auditoría.
  assert.equal(rendered.json.includes(checks.SYNTHETIC_CANARY), false);
  assert.deepEqual(findCanaries(rendered.json), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 30.3 / G.12 — plantillas sin datos sensibles + afirmaciones verificadas con evidencia
// ─────────────────────────────────────────────────────────────────────────────

test("30.3: las plantillas core de PR/ticket se limitan a los campos permitidos y no piden datos sensibles", () => {
  const PR = fs.readFileSync(path.join(TPL_DIR, "PULL_REQUEST_TEMPLATE.md"), "utf8");
  const TICKET = fs.readFileSync(path.join(TPL_DIR, "TICKET_TEMPLATE.md"), "utf8");

  assert.deepEqual(topLevelSections(PR), [...ALLOWED_SECTIONS.pr]);
  assert.deepEqual(topLevelSections(TICKET), [...ALLOWED_SECTIONS.ticket]);

  assert.equal(lintTemplate(PR, { kind: "pr" }).ok, true);
  assert.equal(lintTemplate(TICKET, { kind: "ticket" }).ok, true);

  // Y jamás filtran un canario embebido en la propia plantilla.
  assert.deepEqual(findCanaries(PR + TICKET), []);
});

test("30.3: una afirmación 'verificada' SIN evidencia vigente es rechazada (fail-closed)", () => {
  const expectation = { commit: "abc123", scope: "staged", maxAgeHours: 24 };
  // Sin evidencia → rechazada.
  const noEvidence = validateDeclaration({ state: "verificado" }, expectation, { now: NOW_MS });
  assert.equal(noEvidence.ok, false);
  assert.equal(noEvidence.requiresEvidence, true);

  // Con evidencia fresca del mismo commit/alcance → aceptada.
  const fresh = createEvidence({
    control: "secret-scanning",
    command: "scan",
    toolVersion: "8.18.4",
    configHash: "cfg",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    commit: "abc123",
    createdAt: FIXED_NOW,
  });
  const withEvidence = validateDeclaration(
    { state: "verificado", evidence: fresh },
    expectation,
    { now: NOW_MS }
  );
  assert.equal(withEvidence.ok, true, withEvidence.reason);
});

test("30.3: evidencia de OTRO commit o EXPIRADA no sostiene 'verificado'", () => {
  const expectation = { commit: "abc123", scope: "staged", maxAgeHours: 24 };
  const otherCommit = createEvidence({
    control: "secret-scanning",
    command: "scan",
    toolVersion: "8.18.4",
    configHash: "cfg",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    commit: "deadbeef",
    createdAt: FIXED_NOW,
  });
  assert.equal(
    validateDeclaration({ state: "verificado", evidence: otherCommit }, expectation, { now: NOW_MS }).ok,
    false
  );

  const expired = createEvidence({
    control: "secret-scanning",
    command: "scan",
    toolVersion: "8.18.4",
    configHash: "cfg",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    commit: "abc123",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(
    validateDeclaration({ state: "verificado", evidence: expired }, expectation, { now: NOW_MS }).ok,
    false
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Barrido consolidado del checkpoint (G.12): nada de lo que este CP ejercita filtra el canario
// ─────────────────────────────────────────────────────────────────────────────

test("CP G.12: barrido consolidado — ninguna salida del checkpoint contiene el canario sintético", () => {
  // Agregamos TODO lo que las superficies de este checkpoint producen.
  const chunks = [];

  // 1) OWASP móvil con canario embebido.
  const mob = mobile.adaptMobileReport({
    repoRoot: "/tmp/demo-flutter",
    control: "M5",
    isFlutter: true,
    mode: "enforce",
    report: {
      findings: [
        {
          file: "lib/main.dart",
          line: 2,
          issue: "HTTP URL",
          code: `url = "http://x:${SYNTH_AWS}@h/?t=${SYNTH_AWS}"`,
          severity: "HIGH",
        },
      ],
    },
  });
  chunks.push(JSON.stringify(mob.result), JSON.stringify(mob.evidence));

  // 2) Auditoría profunda --deep (self-check con canario interno).
  const enriched = cap.enrichDeep(healthyCapabilities(), path.join(__dirname, "..", ".."), {
    now: FIXED_NOW,
    deep: true,
  });
  const rendered = report.renderAudit({ schemaVersion: 1, generatedAt: FIXED_NOW, capabilities: enriched });
  chunks.push(rendered.json, rendered.human);

  // 3) Plantillas core.
  chunks.push(
    fs.readFileSync(path.join(TPL_DIR, "PULL_REQUEST_TEMPLATE.md"), "utf8"),
    fs.readFileSync(path.join(TPL_DIR, "TICKET_TEMPLATE.md"), "utf8")
  );

  const all = chunks.join("\n");
  assert.equal(all.includes(SYNTH_AWS), false, "el canario sintético de secretos no debe aparecer");
  assert.equal(all.includes(checks.SYNTHETIC_CANARY), false, "el canario del self-check no debe aparecer");
  assert.deepEqual(findCanaries(all), [], "ningún canario reconocible en la salida consolidada del CP");
});
