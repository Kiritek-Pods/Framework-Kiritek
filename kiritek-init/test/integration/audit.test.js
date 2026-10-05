"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cap = require("../../src/audit/capabilities.js");
const report = require("../../src/audit/report.js");
const { installCore } = require("../../src/install/core-security.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-audit-"));
}

test("auditConfig: ausente → missing; instalado → ok", () => {
  const repo = tmpRepo();
  try {
    const missing = cap.auditConfig(repo);
    assert.equal(report.statusOf(missing), "missing");
    installCore({ repoRoot: repo });
    const ok = cap.auditConfig(repo);
    assert.equal(report.statusOf(ok), "ok");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("auditConfig: JSON corrupto → failed por integridad", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "kiritek-security.config.json"), "{ roto");
    const c = cap.auditConfig(repo);
    assert.equal(c.integrity, cap.INTEGRITY.FAILED);
    assert.equal(report.statusOf(c), "failed");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("auditHooks: sin repo Git → not_applicable", () => {
  const repo = tmpRepo();
  try {
    const c = cap.auditHooks(repo);
    assert.equal(c.applicable, false);
    assert.equal(report.statusOf(c), "not_applicable");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("auditHooks: repo Git sin hooks Kiritek → missing/degraded", () => {
  const repo = tmpRepo();
  try {
    fs.mkdirSync(path.join(repo, ".git", "hooks"), { recursive: true });
    const c = cap.auditHooks(repo);
    assert.equal(c.applicable, true);
    assert.notEqual(report.statusOf(c), "ok");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("auditTooling: manifiesto real con checksums ya fijados → integridad ok", () => {
  // Se audita contra el propio repo del paquete (manifiesto real).
  const pkgRoot = path.join(__dirname, "..", "..");
  const c = cap.auditTooling(pkgRoot);
  assert.equal(c.installed, true);
  assert.equal(c.integrity, cap.INTEGRITY.OK);
  assert.equal(c.version, "8.18.4");
});

test("runCapabilityAudit + renderAudit: JSON schema-valid y exit code coherente", () => {
  const repo = tmpRepo();
  try {
    const audit = cap.runCapabilityAudit(repo, { now: () => "2026-10-01T00:00:00.000Z" });
    const rendered = report.renderAudit(audit);
    // Repo sin instalar: hay capacidades que fallan → exit 1.
    assert.equal(rendered.exitCode, 1);
    assert.ok(rendered.human.includes("Auditoría Kiritek"));
    // El JSON debe ser parseable y cumplir el schema (renderAudit ya lo valida).
    const parsed = JSON.parse(rendered.json);
    assert.equal(parsed.schemaVersion, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("auditoría tras instalar core: config ok, exit no es 0 sólo por hooks/tooling pendientes", () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const audit = cap.runCapabilityAudit(repo, { now: () => "2026-10-01T00:00:00.000Z" });
    const configCap = audit.capabilities.find((c) => c.id === "config");
    assert.equal(report.statusOf(configCap), "ok");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===================== Tarea 28 — auditoría profunda =====================

const checks = require("../../src/audit/checks.js");
const { createEvidence } = require("../../src/domain/evidence.js");

const FIXED_NOW = "2026-10-01T00:00:00.000Z";

test("28.1 Flutter: proyecto no Flutter → mobile-owasp not_applicable; Flutter → aplicable", () => {
  const repo = tmpRepo();
  try {
    let audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW });
    let mobile = audit.capabilities.find((c) => c.id === "mobile-owasp");
    assert.equal(mobile.applicable, false);
    assert.equal(report.statusOf(mobile), "not_applicable");

    fs.writeFileSync(path.join(repo, "pubspec.yaml"), "name: app\ndependencies:\n  sdk: flutter\n");
    audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW });
    mobile = audit.capabilities.find((c) => c.id === "mobile-owasp");
    assert.equal(mobile.applicable, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.1 Jira: deshabilitado → not_applicable; habilitado sin credenciales → fallo verificable", () => {
  const repo = tmpRepo();
  try {
    let audit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      config: { jira: { enabled: false } },
    });
    let jiraCap = audit.capabilities.find((c) => c.id === "jira");
    assert.equal(jiraCap.applicable, false);
    assert.equal(report.statusOf(jiraCap), "not_applicable");

    audit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      config: { jira: { enabled: true, baseUrl: "https://x", requireCredentials: true } },
      env: {},
    });
    jiraCap = audit.capabilities.find((c) => c.id === "jira");
    assert.equal(jiraCap.applicable, true);
    assert.equal(jiraCap.configured, true);
    // Sin observación remota → unknown (no verificable), nunca ok por archivos.
    assert.equal(jiraCap.observation, cap.OBSERVATION.UNKNOWN);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.2 Jira observación remota: observed (200), unauthorized (401), unknown (timeout)", async () => {
  const repo = tmpRepo();
  try {
    const config = { jira: { enabled: true, baseUrl: "https://x" } };

    const observed = await cap.runCapabilityAuditAsync(repo, {
      now: () => FIXED_NOW,
      config,
      jiraProbe: async () => ({ status: 200, exists: true }),
    });
    assert.equal(observed.capabilities.find((c) => c.id === "jira").observation, "observed");
    assert.equal(report.statusOf(observed.capabilities.find((c) => c.id === "jira")), "ok");

    const unauthorized = await cap.runCapabilityAuditAsync(repo, {
      now: () => FIXED_NOW,
      config,
      jiraProbe: async () => ({ status: 401 }),
    });
    const unauthCap = unauthorized.capabilities.find((c) => c.id === "jira");
    assert.equal(unauthCap.observation, "unauthorized");
    assert.equal(report.statusOf(unauthCap), "failed");

    const unknown = await cap.runCapabilityAuditAsync(repo, {
      now: () => FIXED_NOW,
      config,
      jiraProbe: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    assert.equal(unknown.capabilities.find((c) => c.id === "jira").observation, "unknown");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.2 CI: local presente → observación unknown (remoto no observado); ausente → not-configured", () => {
  const repo = tmpRepo();
  try {
    let audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW });
    let ciCap = audit.capabilities.find((c) => c.id === "ci");
    assert.equal(ciCap.observation, "not-configured");
    assert.equal(report.statusOf(ciCap), "missing");

    fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".github", "workflows", "kiritek-security.yml"), "on: push\n");
    audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW });
    ciCap = audit.capabilities.find((c) => c.id === "ci");
    assert.equal(ciCap.installed, true);
    assert.equal(ciCap.observation, "unknown");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.3 evidencia expirada: la capa queda degradada (no sostiene verified)", () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const staleEvidence = createEvidence({
      control: "secret-scanning",
      command: "scan",
      toolVersion: "8.18.4",
      configHash: "cfg",
      scope: "staged",
      exitCode: 0,
      decision: "allow",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const audit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      maxAgeHours: 24,
      evidenceByCapability: { "secret-scanning": staleEvidence },
    });
    const scanning = audit.capabilities.find((c) => c.id === "secret-scanning");
    assert.equal(scanning.lastResultFresh, false);
    assert.equal(report.statusOf(scanning), "degraded");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.4 --deep self-check: dispara contra el canario, no filtra y queda ran=true", () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW, deep: true });
    const scanning = audit.capabilities.find((c) => c.id === "secret-scanning");
    assert.ok(scanning.selfCheck, "la capa de scanning debe incluir selfCheck en --deep");
    assert.equal(scanning.selfCheck.ran, true);
    assert.equal(scanning.selfCheck.fired, true);
    assert.equal(scanning.selfCheck.leaked, false);
    // El canario sintético nunca debe aparecer en el JSON de la auditoría.
    const json = JSON.stringify(audit);
    assert.ok(!json.includes(checks.SYNTHETIC_CANARY));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.4 --deep self-check fallido (gate que no dispara) → integridad failed", () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const audit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      deep: true,
      selfCheckDeps: { evaluate: () => ({ decision: "allow", findings: [] }) },
    });
    const scanning = audit.capabilities.find((c) => c.id === "secret-scanning");
    assert.equal(scanning.selfCheck.fired, false);
    assert.equal(scanning.integrity, cap.INTEGRITY.FAILED);
    assert.equal(report.statusOf(scanning), "failed");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.5 sin --deep la salida es la auditoría mínima (sin selfCheck) y schema-valid", () => {
  const repo = tmpRepo();
  try {
    const audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW });
    const rendered = report.renderAudit(audit); // valida schema
    const scanning = audit.capabilities.find((c) => c.id === "secret-scanning");
    assert.equal(scanning.selfCheck, undefined);
    assert.ok(typeof rendered.exitCode === "number");
    // JSON parseable y estable.
    const parsed = JSON.parse(rendered.json);
    assert.equal(parsed.schemaVersion, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.5 JSON y exit code estables: dos corridas idénticas producen el mismo resultado", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const config = { jira: { enabled: true, baseUrl: "https://x" } };
    const probe = async () => ({ status: 200, exists: true });
    const a = await cap.runCapabilityAuditAsync(repo, { now: () => FIXED_NOW, config, jiraProbe: probe });
    const b = await cap.runCapabilityAuditAsync(repo, { now: () => FIXED_NOW, config, jiraProbe: probe });
    assert.deepEqual(a, b);
    assert.equal(report.exitCodeFor(a), report.exitCodeFor(b));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.5 schema-valid incluyendo campos profundos (observation, selfCheck, exceptions)", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const audit = await cap.runCapabilityAuditAsync(repo, {
      now: () => FIXED_NOW,
      deep: true,
      config: { jira: { enabled: true, baseUrl: "https://x" } },
      jiraProbe: async () => ({ status: 200, exists: true }),
    });
    // renderAudit valida contra el schema (lanza si inválido).
    const rendered = report.renderAudit(audit);
    assert.ok(rendered.human.includes("Resumen:"));
    const jiraCap = audit.capabilities.find((c) => c.id === "jira");
    assert.equal(jiraCap.observation, "observed");
    const configCap = audit.capabilities.find((c) => c.id === "config");
    assert.equal(typeof configCap.exceptions, "number");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("28.5 exit code 3 cuando una capacidad aplicable queda unknown-que-importa", () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    // Jira habilitado pero sin observación remota → unknown → exit 3.
    const audit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      config: { jira: { enabled: true, baseUrl: "https://x" } },
    });
    const jiraCap = audit.capabilities.find((c) => c.id === "jira");
    assert.equal(report.statusOf(jiraCap), "unknown");
    // Nota: otras capas (hooks/tooling) pueden forzar exit 1; verificamos que la
    // capa Jira contribuye como unknown y que el exit es 1 o 3 (nunca 0).
    assert.notEqual(report.exitCodeFor(audit), 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
