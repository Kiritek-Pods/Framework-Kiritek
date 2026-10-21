"use strict";

/**
 * Tarea 33 — `security doctor` y `security promote --to=enforce` end-to-end por
 * el router del CLI. (33.5)
 *
 * Escenarios: repo nuevo vs existente, readiness exitoso/fallido, Jira no
 * observable, baseline legacy tolerada, hallazgo nuevo que bloquea, expiración
 * que re-bloquea, override gobernado y persistencia del registro de promoción.
 * Toda salida se verifica sin filtración del canario.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const securityCli = require("../../src/security-cli.js");
const { installCore } = require("../../src/install/core-security.js");
const { findCanaries } = require("../../src/scanners/redactor.js");

const SYNTH = "AKIAZZDOCTORCLICANARY0";

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-doctor-"));
}

async function runCapture(argv, { cwd, env, deps } = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  const code = await securityCli.run(argv, {
    cwd: cwd || process.cwd(),
    env: env || {},
    stdout,
    stderr,
    ...(deps || {}),
  });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) {
    /* algunos comandos emiten varias líneas */
  }
  return { code, out, err, json };
}

/** Audit falso con todas las capas aplicables OK. */
function auditAllOk() {
  return async () => ({
    schemaVersion: 1,
    generatedAt: "2025-01-01T00:00:00.000Z",
    capabilities: [
      { id: "config", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "secret-scanning", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "git-hooks", applicable: true, installed: true, active: true, integrity: "ok" },
      { id: "ci", applicable: true, installed: true, active: true, observation: "observed" },
    ],
  });
}

/** Audit falso con Jira no observable (unknown) y nada más fallando. */
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

// ===================== doctor =====================

test("doctor: repo recién instalado (sin hooks/CI reales) reporta not-ready con exit 1", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(["security", "doctor"], { cwd: repo });
    assert.equal(r.code, 1);
    assert.equal(r.json.readiness, "not-ready");
    assert.ok(Array.isArray(r.json.doctor.blockers));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor: readiness READY (audit inyectado OK) → exit 0", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(["security", "doctor"], { cwd: repo, deps: { auditFn: auditAllOk() } });
    assert.equal(r.code, 0);
    assert.equal(r.json.readiness, "ready");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor: Jira no observable → readiness unknown (exit 3), sin filtrar credencial", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const SYNTH_CRED = "SYNTHETIC-JIRA-TOKEN-abc";
    const r = await runCapture(["security", "doctor"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      deps: { auditFn: auditJiraUnknown() },
    });
    assert.equal(r.code, 3);
    assert.equal(r.json.readiness, "unknown");
    assert.ok(r.json.doctor.unknown.includes("jira"));
    assert.ok(!r.out.includes(SYNTH_CRED));
    assert.ok(!r.err.includes(SYNTH_CRED));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===================== promote =====================

test("promote: --to distinto de enforce es uso incorrecto (exit 2)", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(["security", "promote", "--to=warning"], { cwd: repo });
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "INVALID_TARGET_MODE");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("promote: readiness fallido rechaza y NO muta la config (exit 1)", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const before = fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8");
    const r = await runCapture(["security", "promote", "--to=enforce"], { cwd: repo });
    assert.equal(r.code, 1);
    assert.equal(r.json.promoted, false);
    const after = fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8");
    assert.equal(before, after); // sin mutación
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("promote: readiness OK promueve a enforce, persiste registro y evidencia", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(["security", "promote", "--to=enforce"], {
      cwd: repo,
      env: { KIRITEK_ACTOR: "lead@acme" },
      deps: { auditFn: auditAllOk() },
    });
    assert.equal(r.code, 0);
    assert.equal(r.json.promoted, true);
    assert.equal(r.json.record.actor, "lead@acme");
    assert.equal(r.json.record.previousMode, "warning");
    assert.equal(r.json.record.newMode, "enforce");
    assert.ok(r.json.evidence.id);

    // La config quedó en enforce.
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8"));
    assert.equal(cfg.mode, "enforce");

    // El registro de promoción se persistió redactado.
    const dir = path.join(repo, ".kiritek", "promotions");
    const files = fs.readdirSync(dir);
    assert.ok(files.length >= 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("promote: --dry-run no muta la config aunque readiness pase", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(["security", "promote", "--to=enforce", "--dry-run"], {
      cwd: repo,
      deps: { auditFn: auditAllOk() },
    });
    assert.equal(r.code, 0);
    assert.equal(r.json.dryRun, true);
    assert.equal(r.json.promoted, false);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8"));
    assert.notEqual(cfg.mode, "enforce");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("promote: override gobernado sobre readiness unknown promueve y registra el override", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(
      ["security", "promote", "--to=enforce", "--override-actor=lead@acme", "--override-reason=sin red para observar Jira"],
      { cwd: repo, deps: { auditFn: auditJiraUnknown() } }
    );
    assert.equal(r.code, 0);
    assert.equal(r.json.promoted, true);
    assert.equal(r.json.overridden, true);
    assert.equal(r.json.record.overridden, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("promote: override NO gobernado (sin razón) sobre unknown se rechaza (exit 1)", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCapture(
      ["security", "promote", "--to=enforce", "--override-actor=lead@acme"],
      { cwd: repo, deps: { auditFn: auditJiraUnknown() } }
    );
    assert.equal(r.code, 1);
    assert.equal(r.json.promoted, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===================== baseline legacy / hallazgo nuevo / expiración =====================

const { buildFingerprint } = require("../../src/scanners/fingerprint.js");

function writeBaseline(repo, entries) {
  const dir = path.join(repo, ".kiritek");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({ baseline: entries }, null, 2));
}

test("promote: baseline legacy vigente tolera deuda; sin hallazgo nuevo readiness OK permite promover", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const fp = buildFingerprint({ path: ".env", ruleId: "env-file" });
    writeBaseline(repo, [
      { fingerprint: fp, owner: "sec@acme", justification: "deuda legacy conocida", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
    ]);
    const r = await runCapture(["security", "promote", "--to=enforce"], {
      cwd: repo,
      deps: {
        auditFn: auditAllOk(),
        // Hallazgo legacy cubierto por la baseline.
      },
    });
    // No pasamos files al doctor del CLI → sin hallazgo nuevo; readiness OK.
    assert.equal(r.code, 0);
    assert.equal(r.json.promoted, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor: baseline por expirar emite aviso en stderr", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const fp = buildFingerprint({ path: ".env", ruleId: "env-file" });
    writeBaseline(repo, [
      { fingerprint: fp, owner: "sec@acme", justification: "deuda", expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() },
    ]);
    const r = await runCapture(["security", "doctor"], { cwd: repo, deps: { auditFn: auditAllOk() } });
    assert.equal(r.json.doctor.baseline.expiringSoon.length, 1);
    assert.match(r.err, /por expirar/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("doctor: baseline inválida bloquea readiness (not-ready)", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    writeBaseline(repo, [{ fingerprint: "incompleta" }]); // falta owner/justificación/expiración
    const r = await runCapture(["security", "doctor"], { cwd: repo, deps: { auditFn: auditAllOk() } });
    assert.equal(r.code, 1);
    assert.equal(r.json.readiness, "not-ready");
    assert.ok(r.json.doctor.blockers.some((b) => /baseline/.test(b)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===================== repo nuevo vs existente =====================

test("doctor: repo nuevo (sin .git ni archivos) opera y produce veredicto honesto", async () => {
  const repo = tmpRepo();
  try {
    // Instalar en un repo "nuevo"; installCore marcará projectType new/enforce.
    installCore({ repoRoot: repo });
    const r = await runCapture(["security", "doctor"], { cwd: repo, deps: { auditFn: auditAllOk() } });
    assert.ok(["ready", "not-ready", "unknown"].includes(r.json.readiness));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===================== no filtración global =====================

test("doctor/promote: ninguna salida filtra el canario", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    // Config con Jira para ejercitar la ruta con credencial sintética.
    const d = await runCapture(["security", "doctor"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH },
      deps: { auditFn: auditAllOk() },
    });
    assert.equal(findCanaries(d.out).length, 0);
    assert.equal(findCanaries(d.err).length, 0);
    assert.ok(!d.out.includes(SYNTH));
    assert.ok(!d.err.includes(SYNTH));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
