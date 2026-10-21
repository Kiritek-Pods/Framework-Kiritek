"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const checks = require("../../src/audit/checks.js");
const jira = require("../../src/integrations/jira.js");
const { createEvidence } = require("../../src/domain/evidence.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-checks-"));
}

// --- 28.1 Flutter applicability (via detect.js, not file presence) ---

test("isFlutterProject: true sólo cuando pubspec declara flutter", () => {
  const repo = tmpRepo();
  try {
    assert.equal(checks.isFlutterProject(repo), false);
    fs.writeFileSync(
      path.join(repo, "pubspec.yaml"),
      "name: app\ndependencies:\n  sdk: flutter\n"
    );
    assert.equal(checks.isFlutterProject(repo), true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- 28.1 Claude/Kiro real linkage ---

test("claudeLinkage: shim sin settings → no enlazado; con matchers → enlazado", () => {
  const repo = tmpRepo();
  try {
    let link = checks.claudeLinkage(repo);
    assert.equal(link.settingsPresent, false);
    assert.equal(link.linked, false);

    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Edit|Write", hooks: [] },
            { matcher: "Bash", hooks: [] },
          ],
        },
      })
    );
    link = checks.claudeLinkage(repo);
    assert.equal(link.formatSupported, true);
    assert.equal(link.writeLinked, true);
    assert.equal(link.commandLinked, true);
    assert.equal(link.linked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("claudeLinkage: settings sin matchers de política → formato soportado pero no enlazado", () => {
  const repo = tmpRepo();
  try {
    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Read", hooks: [] }] } })
    );
    const link = checks.claudeLinkage(repo);
    assert.equal(link.formatSupported, true);
    assert.equal(link.linked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiroLinkage: hooks v1 propiedad de Kiritek con matchers → enlazado", () => {
  const repo = tmpRepo();
  try {
    let link = checks.kiroLinkage(repo);
    assert.equal(link.hooksDirPresent, false);
    assert.equal(link.linked, false);

    const hooksDir = path.join(repo, ".kiro", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const cmd = "$REPO/.kiritek/adapters/kiro/pretooluse.sh";
    fs.writeFileSync(
      path.join(hooksDir, "write.json"),
      JSON.stringify({
        version: "v1",
        hooks: [
          { name: "w", trigger: "PreToolUse", matcher: "fs_write|str_replace", action: { type: "command", command: cmd } },
        ],
      })
    );
    fs.writeFileSync(
      path.join(hooksDir, "cmd.json"),
      JSON.stringify({
        version: "v1",
        hooks: [
          { name: "c", trigger: "PreToolUse", matcher: "execute_bash|use_aws", action: { type: "command", command: cmd } },
        ],
      })
    );
    link = checks.kiroLinkage(repo);
    assert.equal(link.formatSupported, true);
    assert.equal(link.kiritekOwned, true);
    assert.equal(link.writeLinked, true);
    assert.equal(link.commandLinked, true);
    assert.equal(link.linked, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("kiroLinkage: formato no soportado (version !== v1) → no soportado", () => {
  const repo = tmpRepo();
  try {
    const hooksDir = path.join(repo, ".kiro", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "legacy.json"),
      JSON.stringify({
        version: "v2",
        hooks: [{ matcher: "fs_write", action: { command: ".kiritek/adapters/kiro/pretooluse.sh" } }],
      })
    );
    const link = checks.kiroLinkage(repo);
    assert.equal(link.formatSupported, false);
    assert.equal(link.linked, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- 28.1 Jira configured/verifiable (credential presence from env, never value) ---

test("jiraConfiguration: configurado requiere enabled + baseUrl; verificable requiere credencial presente", () => {
  const base = { jira: { enabled: true, baseUrl: "https://x.atlassian.net", requireCredentials: true } };
  const noCreds = checks.jiraConfiguration(base, {});
  assert.equal(noCreds.configured, true);
  assert.equal(noCreds.credentialsPresent, false);
  assert.equal(noCreds.verifiable, false);

  const withCreds = checks.jiraConfiguration(base, { KIRITEK_JIRA_TOKEN: "s3cr3t-value" });
  assert.equal(withCreds.credentialsPresent, true);
  assert.equal(withCreds.verifiable, true);
});

test("jiraConfiguration: nunca expone el valor de la credencial", () => {
  const cfg = checks.jiraConfiguration(
    { jira: { enabled: true, baseUrl: "https://x" } },
    { KIRITEK_JIRA_TOKEN: "SUPER-SECRET-TOKEN" }
  );
  const serialized = JSON.stringify(cfg);
  assert.ok(!serialized.includes("SUPER-SECRET-TOKEN"));
});

// --- 28.2 Remote observation from an actual probe (not file inference) ---

test("probeJira: not-configured cuando Jira deshabilitado o sin baseUrl", async () => {
  const off = await checks.probeJira({ config: { jira: { enabled: false } }, env: {}, probe: () => ({ status: 200 }) });
  assert.equal(off.observation, checks.OBSERVATION.NOT_CONFIGURED);

  const noUrl = await checks.probeJira({ config: { jira: { enabled: true } }, env: {}, probe: () => ({ status: 200 }) });
  assert.equal(noUrl.observation, checks.OBSERVATION.NOT_CONFIGURED);
});

test("probeJira: observed cuando el tenant responde 200", async () => {
  const r = await checks.probeJira({
    config: { jira: { enabled: true, baseUrl: "https://x" } },
    env: {},
    probe: async () => ({ status: 200, exists: true }),
  });
  assert.equal(r.observation, checks.OBSERVATION.OBSERVED);
});

test("probeJira: unauthorized con 401", async () => {
  const r = await checks.probeJira({
    config: { jira: { enabled: true, baseUrl: "https://x" } },
    env: {},
    probe: async () => ({ status: 401 }),
  });
  assert.equal(r.observation, checks.OBSERVATION.UNAUTHORIZED);
});

test("probeJira: unknown cuando el probe lanza (timeout/red)", async () => {
  const r = await checks.probeJira({
    config: { jira: { enabled: true, baseUrl: "https://x" } },
    env: {},
    probe: async () => {
      throw new Error("ETIMEDOUT");
    },
  });
  assert.equal(r.observation, checks.OBSERVATION.UNKNOWN);
});

test("probeJira: credenciales obligatorias ausentes → unauthorized sin intentar red", async () => {
  let called = false;
  const r = await checks.probeJira({
    config: { jira: { enabled: true, baseUrl: "https://x", requireCredentials: true } },
    env: {},
    probe: async () => {
      called = true;
      return { status: 200 };
    },
  });
  assert.equal(r.observation, checks.OBSERVATION.UNAUTHORIZED);
  assert.equal(called, false);
});

test("probeJira: sin transporte → unknown (nunca observed por archivos)", async () => {
  const r = await checks.probeJira({
    config: { jira: { enabled: true, baseUrl: "https://x" } },
    env: {},
  });
  assert.equal(r.observation, checks.OBSERVATION.UNKNOWN);
});

// --- 28.3 Freshness / commit / enforcement ---

test("evidenceFreshness: evidencia vigente del mismo commit sostiene verified", () => {
  const nowMs = Date.parse("2026-10-01T00:00:00.000Z");
  const ev = createEvidence({
    control: "secret-scanning",
    command: "scan",
    toolVersion: "8.18.4",
    configHash: "abc123",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    commit: "deadbeef",
    createdAt: "2026-09-30T23:00:00.000Z",
  });
  const f = checks.evidenceFreshness(ev, { maxAgeHours: 24, commit: "deadbeef" }, { now: () => nowMs });
  assert.equal(f.present, true);
  assert.equal(f.fresh, true);
  assert.equal(f.commit, "deadbeef");
  assert.equal(f.configHash, "abc123");
});

test("evidenceFreshness: evidencia expirada no es fresca", () => {
  const nowMs = Date.parse("2026-10-05T00:00:00.000Z");
  const ev = createEvidence({
    control: "secret-scanning",
    command: "scan",
    toolVersion: "8.18.4",
    configHash: "abc123",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const f = checks.evidenceFreshness(ev, { maxAgeHours: 24 }, { now: () => nowMs });
  assert.equal(f.fresh, false);
  assert.match(f.reason, /expirado/);
});

test("evidenceFreshness: sin evidencia → present=false, no verified", () => {
  const f = checks.evidenceFreshness(null);
  assert.equal(f.present, false);
  assert.equal(f.fresh, null);
  assert.equal(f.lastResult, "unknown");
});

// --- 28.3 Exceptions ---

test("activeExceptions: cuenta activas vs expiradas sin leer contenido sensible", () => {
  const repo = tmpRepo();
  try {
    fs.mkdirSync(path.join(repo, ".kiritek"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".kiritek", "exceptions.json"),
      JSON.stringify({
        exceptions: [
          { controlId: "c1", expiresAt: "2999-01-01T00:00:00.000Z" },
          { controlId: "c2", expiresAt: "2000-01-01T00:00:00.000Z" },
        ],
      })
    );
    const r = checks.activeExceptions(repo, { now: () => Date.parse("2026-10-01T00:00:00.000Z") });
    assert.equal(r.total, 2);
    assert.equal(r.active, 1);
    assert.equal(r.expired, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- 28.4 Synthetic self-check: must fire, clean up, never leak ---

test("runSyntheticSelfCheck: el gate dispara contra el canario y NO lo filtra", () => {
  const r = checks.runSyntheticSelfCheck();
  assert.equal(r.ran, true);
  assert.equal(r.fired, true, "el control debe disparar contra el .env sintético");
  assert.equal(r.leaked, false, "el canario sintético nunca debe filtrarse");
});

test("runSyntheticSelfCheck: limpia el temporal (no deja artefactos)", () => {
  const base = tmpRepo();
  try {
    const r = checks.runSyntheticSelfCheck({ tmpBase: base });
    assert.equal(r.ran, true);
    // No deben quedar directorios de self-check en la base.
    const left = fs.readdirSync(base).filter((n) => n.startsWith("kiritek-selfcheck-"));
    assert.equal(left.length, 0, "el self-check debe limpiar su temporal en finally");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("runSyntheticSelfCheck: detecta un gate que NO dispara (evaluate inyectado)", () => {
  const r = checks.runSyntheticSelfCheck({
    tmpBase: tmpRepo(),
    evaluate: () => ({ decision: "allow", findings: [] }),
  });
  assert.equal(r.fired, false);
  assert.match(r.reason, /NO disparó/);
});

test("runSyntheticSelfCheck: el canario nunca aparece en el resultado serializado", () => {
  const r = checks.runSyntheticSelfCheck();
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes(checks.SYNTHETIC_CANARY));
});

// --- 28.3 default branch drift ---

test("defaultBranchDrift: sin repo Git → not applicable", () => {
  const repo = tmpRepo();
  try {
    const r = checks.defaultBranchDrift(repo, {});
    assert.equal(r.applicable, false);
    assert.equal(r.drift, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
