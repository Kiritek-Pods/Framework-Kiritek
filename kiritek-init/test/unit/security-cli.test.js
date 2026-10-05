"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securityCli = require("../../src/security-cli.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-cli-"));
}

/** Captura stdout/stderr de una ejecución del router. */
function runCapture(argv, { cwd, env, secrets } = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  const code = securityCli.run(argv, { cwd: cwd || process.cwd(), env: env || {}, stdout, stderr, secrets });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) {
    /* algunos comandos emiten varias líneas; se prueba aparte */
  }
  return { code, out, err, json };
}

test("version: stdout JSON parseable con la versión", () => {
  const r = runCapture(["--version"]);
  assert.equal(r.code, 0);
  assert.equal(r.json.version, securityCli.VERSION);
});

test("scan: staged en repo git limpio sin gitleaks en cache advierte (warning), no declara limpio", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    const r = runCapture(["scan", "--scope=staged"], { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.scope, "staged");
    assert.equal(r.json.scanned, 0);
    assert.equal(r.json.status, undefined, "scan ya no devuelve el estado pending");
    // Motor de archivos: allow. Gitleaks (offline en pruebas): unavailable → warn.
    assert.equal(r.json.decision, "warn");
    const gl = r.json.controls.find((c) => c.controlId === "secrets.gitleaks");
    assert.equal(gl.toolStatus, "unavailable");
    assert.equal(gl.decision, "warn");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scan: staged detecta un archivo sensible staged en enforce (deny, exit 1)", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    fs.writeFileSync(path.join(repo, ".env"), "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n");
    spawnSync("git", ["-C", repo, "add", ".env"], { encoding: "utf8" });
    const r = runCapture(["scan", "--scope=staged", "--mode=enforce"], { cwd: repo });
    assert.equal(r.code, 1, "un archivo sensible staged en enforce bloquea");
    assert.equal(r.json.decision, "deny");
    assert.equal(r.json.scanned, 1);
    // El valor sensible nunca aparece en la salida (contrato de redacción).
    assert.equal(r.out.includes("wJalrXUtnFEMI"), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scan: scope repository sin binario es honesto: warn en warning, error/exit 1 en enforce", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    const w = runCapture(["scan", "--scope=repository"], { cwd: repo });
    assert.equal(w.code, 0);
    assert.equal(w.json.decision, "warn");
    assert.equal(w.json.result.toolStatus, "unavailable");
    const e = runCapture(["scan", "--scope=repository", "--mode=enforce"], { cwd: repo });
    assert.equal(e.code, 1, "no se declara limpio sin ejecutar el escáner real");
    assert.equal(e.json.decision, "error");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/** Gitleaks falso: registra args y simula un reporte (sin binario real). */
function fakeGitleaks({ status, report }) {
  const calls = [];
  return {
    calls,
    secrets: {
      tool: { status: "ok", binaryPath: "/fake/gitleaks", version: "8.18.4" },
      exec: (bin, args) => {
        calls.push(args);
        const rp = args[args.indexOf("--report-path") + 1];
        if (report) fs.writeFileSync(rp, JSON.stringify(report));
        return { status, stdout: "", stderr: "" };
      },
    },
  };
}

test("scan: staged ejecuta gitleaks protect --staged sin bypasses no gobernados", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    const fake = fakeGitleaks({ status: 0 });
    const r = runCapture(["scan", "--scope=staged"], { cwd: repo, secrets: fake.secrets });
    assert.equal(r.code, 0);
    assert.equal(r.json.decision, "allow");
    assert.equal(r.json.gitleaksVersion, "8.18.4");
    const args = fake.calls[0];
    assert.deepEqual(args.slice(0, 2), ["protect", "--staged"]);
    assert.ok(args.includes("--redact"));
    assert.ok(args.includes("--ignore-gitleaks-allow"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scan: hallazgo de gitleaks bloquea en enforce sin filtrar el secreto", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    const fake = fakeGitleaks({
      status: 1,
      report: [{ RuleID: "github-pat", File: path.join(repo, "src/app.js"), StartLine: 3, Secret: "ghp_SINTETICO", Match: "ghp_SINTETICO" }],
    });
    const r = runCapture(["scan", "--scope=repository", "--mode=enforce"], { cwd: repo, secrets: fake.secrets });
    assert.equal(r.code, 1);
    assert.equal(r.json.decision, "deny");
    assert.equal(r.json.result.findings[0].ruleId, "github-pat");
    assert.equal(r.json.result.findings[0].path, "src/app.js");
    assert.equal(r.out.includes("ghp_SINTETICO"), false);
    assert.deepEqual(fake.calls[0].slice(0, 2), ["detect", "--no-git"]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scan: una excepción gobernada válida cubre el hallazgo de gitleaks", () => {
  const repo = tmpRepo();
  try {
    spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
    fs.mkdirSync(path.join(repo, ".kiritek"));
    const now = Date.now();
    const exc = {
      schemaVersion: 1,
      controlId: "secrets.gitleaks",
      scopePath: "test/fixtures/fake.txt",
      reason: "fixture sintético",
      owner: "dev-a",
      approver: "dev-b",
      ticket: "SEC-1",
      createdAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
    };
    fs.writeFileSync(path.join(repo, ".kiritek", "exceptions.json"), JSON.stringify({ exceptions: [exc] }));
    const fake = fakeGitleaks({
      status: 1,
      report: [{ RuleID: "generic-api-key", File: path.join(repo, "test/fixtures/fake.txt"), StartLine: 1 }],
    });
    const ok = runCapture(["scan", "--scope=repository", "--mode=enforce"], { cwd: repo, secrets: fake.secrets });
    assert.equal(ok.code, 0);
    assert.equal(ok.json.decision, "allow");

    // Sin aprobador distinto la excepción no es válida → no cubre nada.
    delete exc.approver;
    fs.writeFileSync(path.join(repo, ".kiritek", "exceptions.json"), JSON.stringify({ exceptions: [exc] }));
    const bad = runCapture(["scan", "--scope=repository", "--mode=enforce"], { cwd: repo, secrets: fake.secrets });
    assert.equal(bad.code, 1);
    assert.equal(bad.json.decision, "deny");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("scan: scope inválido devuelve exit 2 y error en JSON", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["scan", "--scope=weird"], { cwd: repo });
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, "INVALID_SCOPE");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("flag desconocido: exit 2 y stderr con diagnóstico humano", () => {
  const r = runCapture(["scan", "--nope"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /flag desconocido/);
  assert.equal(r.json.ok, false);
});

test("validate config: reporta configValid", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["validate", "config"], { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.configValid, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validate target inválido: exit 2", () => {
  const r = runCapture(["validate", "nonsense"]);
  // "nonsense" no es subcomando conocido de validate → el parser no lo marca
  // como subcommand, llega como positional y el router lo rechaza.
  assert.equal(r.code, 2);
  assert.equal(r.json.error, "INVALID_TARGET");
});

test("--security=off sin --yes exige confirmación (exit 2)", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["scan", "--security=off"], { cwd: repo });
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "CONFIRMATION_REQUIRED");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("--security=off con --yes marca compliant:false", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["scan", "--security=off", "--yes"], { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.compliant, false);
    assert.equal(r.json.securityOff, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("config inválida en el repo: exit 2 sin mutar", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, "kiritek-security.config.json"), JSON.stringify({ version: 1, mode: "turbo" }));
    const r = runCapture(["scan"], { cwd: repo });
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("precedencia visible: origin refleja la fuente del modo", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["scan", "--mode=enforce"], { cwd: repo });
    assert.equal(r.json.mode, "enforce");
    assert.equal(r.json.origin.mode, "flag");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===================== Tarea 28 — security audit [--deep] =====================

const { installCore } = require("../../src/install/core-security.js");

/** Captura async para comandos que retornan Promise (audit observa Jira). */
async function runCaptureAsync(argv, { cwd, env, deps } = {}) {
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
  return { code, out, err };
}

test("security audit: stdout JSON schema-valid y exit code numérico", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCaptureAsync(["security", "audit"], { cwd: repo });
    const json = JSON.parse(r.out);
    assert.equal(json.schemaVersion, 1);
    assert.ok(Array.isArray(json.capabilities));
    assert.ok([0, 1, 3].includes(r.code));
    assert.match(r.err, /Auditoría Kiritek/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("security audit --deep: incluye selfCheck sin filtrar el canario", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    const r = await runCaptureAsync(["security", "audit", "--deep"], { cwd: repo });
    const json = JSON.parse(r.out);
    const scanning = json.capabilities.find((c) => c.id === "secret-scanning");
    assert.ok(scanning.selfCheck);
    assert.equal(scanning.selfCheck.ran, true);
    assert.equal(scanning.selfCheck.fired, true);
    assert.equal(scanning.selfCheck.leaked, false);
    const checks = require("../../src/audit/checks.js");
    assert.ok(!r.out.includes(checks.SYNTHETIC_CANARY));
    assert.ok(!r.err.includes(checks.SYNTHETIC_CANARY));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("security audit --deep: observa Jira con transporte inyectado, sin filtrar credenciales", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    // Habilitar Jira vía config de proyecto.
    fs.writeFileSync(
      path.join(repo, "kiritek-security.config.json"),
      JSON.stringify({ version: 1, mode: "warning", jira: { enabled: true, baseUrl: "https://x.atlassian.net" } })
    );
    const SYNTH_CRED = "SYNTHETIC-JIRA-TOKEN-xyz";
    const r = await runCaptureAsync(["security", "audit", "--deep"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      deps: { jiraTransport: async () => ({ status: 200, exists: true }) },
    });
    const json = JSON.parse(r.out);
    const jiraCap = json.capabilities.find((c) => c.id === "jira");
    assert.equal(jiraCap.observation, "observed");
    // La credencial jamás debe aparecer en stdout ni stderr.
    assert.ok(!r.out.includes(SYNTH_CRED));
    assert.ok(!r.err.includes(SYNTH_CRED));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("security audit --deep --offline: no intenta observar Jira (sin red)", async () => {
  const repo = tmpRepo();
  try {
    installCore({ repoRoot: repo });
    fs.writeFileSync(
      path.join(repo, "kiritek-security.config.json"),
      JSON.stringify({ version: 1, mode: "warning", jira: { enabled: true, baseUrl: "https://x" } })
    );
    let probed = false;
    const r = await runCaptureAsync(["security", "audit", "--deep", "--offline"], {
      cwd: repo,
      deps: {
        jiraTransport: async () => {
          probed = true;
          return { status: 200 };
        },
      },
    });
    const json = JSON.parse(r.out);
    const jiraCap = json.capabilities.find((c) => c.id === "jira");
    // Offline: no se arma el probe → observación unknown, sin tocar el transporte.
    assert.equal(probed, false);
    assert.equal(jiraCap.observation, "unknown");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
