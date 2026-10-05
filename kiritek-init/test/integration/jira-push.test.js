"use strict";

/**
 * Integración del validador Jira remoto con pre-push y CI (Tarea 23.5–23.6).
 *
 * Verifica que:
 *  - `validate push` extrae las claves Jira del rango real de un repo Git
 *    temporal y las valida contra un transporte MOCK (sin red real);
 *  - pre-push y CI (mismo evento/rango) validan EXACTAMENTE las mismas claves
 *    (paridad) y producen la misma decisión con el mismo commit+config;
 *  - ningún valor de credencial sintético aparece en la salida.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securityCli = require("../../src/security-cli.js");
const { jiraKeysForPush } = require("../../src/scanners/push-scan.js");

const ZEROS = "0".repeat(40);
const SYNTH_CRED = "synthetic-jira-token-PLACEHOLDER";

function git(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-jira-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@e.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}
function commit(repo, file, content, msg) {
  const abs = path.join(repo, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", msg]);
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim();
}

/** Config de proyecto con Jira habilitado y tenant sintético. */
function writeJiraConfig(repo, extra = {}) {
  const config = {
    version: 1,
    mode: "enforce",
    jira: {
      enabled: true,
      baseUrl: "https://acme.atlassian.net",
      keyPattern: "[A-Z][A-Z0-9]+-[0-9]+",
      cacheTtlSeconds: 300,
      unavailable: "fail-closed",
      ...extra,
    },
  };
  fs.writeFileSync(path.join(repo, "kiritek-security.config.json"), JSON.stringify(config));
}

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

/** Transporte mock parametrizable por clave. */
function mockTransport(map = {}) {
  return async ({ key }) => map[key] || { status: 200, exists: true };
}

test("validate push: clave existente en commit del rango → allow (verificado)", async () => {
  const repo = initRepo();
  try {
    writeJiraConfig(repo);
    const head = commit(repo, "a.txt", "x", "feat: algo\n\nABC-10 implementado");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const cap = capture();
    const code = await securityCli.run(["validate", "push"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      stdout: cap.stdout,
      stderr: cap.stderr,
      stdinData: stdin,
      jiraTransport: mockTransport({ "ABC-10": { status: 200, exists: true } }),
    });
    assert.equal(code, 0);
    const json = JSON.parse(cap.out);
    assert.equal(json.decision, "allow");
    assert.deepEqual(json.keys, ["ABC-10"]);
    assert.equal(json.verified, true);
    assert.equal(cap.out.includes(SYNTH_CRED), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validate push: clave inexistente (404) → deny en enforce, sin fugas", async () => {
  const repo = initRepo();
  try {
    writeJiraConfig(repo);
    const head = commit(repo, "a.txt", "x", "fix: corrige\n\nABC-999 referencia");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const cap = capture();
    const code = await securityCli.run(["validate", "push"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      stdout: cap.stdout,
      stderr: cap.stderr,
      stdinData: stdin,
      jiraTransport: mockTransport({ "ABC-999": { status: 404 } }),
    });
    assert.equal(code, 1);
    const json = JSON.parse(cap.out);
    assert.equal(json.decision, "deny");
    assert.equal(json.verified, false);
    assert.equal(cap.out.includes(SYNTH_CRED), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validate push: 401 con fallback warn → no bloquea, no_verificado_remotamente", async () => {
  const repo = initRepo();
  try {
    writeJiraConfig(repo, { unavailable: "warn" });
    const head = commit(repo, "a.txt", "x", "feat: y\n\nABC-11 ok");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const cap = capture();
    const code = await securityCli.run(["validate", "push"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      stdout: cap.stdout,
      stderr: cap.stderr,
      stdinData: stdin,
      jiraTransport: mockTransport({ "ABC-11": { status: 401 } }),
    });
    assert.equal(code, 0);
    const json = JSON.parse(cap.out);
    assert.equal(json.decision, "warn");
    assert.equal(json.remoteState, "no_verificado_remotamente");
    assert.equal(json.verified, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validate push: credenciales obligatorias ausentes → error, sin imprimir valor", async () => {
  const repo = initRepo();
  try {
    writeJiraConfig(repo, { requireCredentials: true });
    const head = commit(repo, "a.txt", "x", "feat: z\n\nABC-12 ok");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const cap = capture();
    const code = await securityCli.run(["validate", "push"], {
      cwd: repo,
      env: {}, // sin credenciales
      stdout: cap.stdout,
      stderr: cap.stderr,
      stdinData: stdin,
      jiraTransport: mockTransport(),
    });
    assert.equal(code, 1);
    const json = JSON.parse(cap.out);
    assert.equal(json.decision, "error");
    assert.equal(cap.out.includes(SYNTH_CRED), false);
    // La guía menciona la variable de entorno, nunca un valor.
    assert.ok(cap.out.includes("KIRITEK_JIRA_TOKEN") || cap.err.includes("KIRITEK_JIRA_TOKEN"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("paridad pre-push/CI: mismas claves y misma decisión para el mismo commit+config", async () => {
  const repo = initRepo();
  try {
    writeJiraConfig(repo);
    const head = commit(repo, "a.txt", "x", "feat: paridad\n\nABC-20 y ABC-21");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;

    // Las claves extraídas del alcance son la fuente común para pre-push y CI.
    const config = JSON.parse(fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8"));
    const { keys } = jiraKeysForPush({ repoRoot: repo, stdin, config });
    assert.deepEqual(keys.sort(), ["ABC-20", "ABC-21"]);

    const transport = mockTransport({ "ABC-20": { status: 200, exists: true }, "ABC-21": { status: 200, exists: true } });

    // pre-push
    const prePush = capture();
    const prePushCode = await securityCli.run(["validate", "push"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      stdout: prePush.stdout,
      stderr: prePush.stderr,
      stdinData: stdin,
      jiraTransport: transport,
    });

    // CI (mismo evento PR sobre el mismo rango). Caché nueva por run.
    const ci = capture();
    const ciCode = await securityCli.run(["validate", "push", "--event=pull_request"], {
      cwd: repo,
      env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED },
      stdout: ci.stdout,
      stderr: ci.stderr,
      stdinData: stdin,
      jiraTransport: transport,
    });

    const prePushJson = JSON.parse(prePush.out);
    const ciJson = JSON.parse(ci.out);

    assert.equal(prePushCode, ciCode);
    assert.equal(prePushJson.decision, ciJson.decision);
    assert.deepEqual(prePushJson.keys.sort(), ciJson.keys.sort());
    assert.equal(prePushJson.verified, ciJson.verified);
    // El alcance de evidencia distingue origen (push vs ci) pero la decisión no.
    assert.equal(prePushJson.evidence.scope, "push");
    assert.equal(ciJson.evidence.scope, "ci:pull_request");
    // Sin fugas en ninguna salida.
    assert.equal(prePush.out.includes(SYNTH_CRED), false);
    assert.equal(ci.out.includes(SYNTH_CRED), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validate push: Jira deshabilitado → allow sin consultar", async () => {
  const repo = initRepo();
  try {
    // sin config de proyecto → jira.enabled default false
    const head = commit(repo, "a.txt", "x", "feat: nada\n\nABC-30");
    const stdin = `refs/heads/feat ${head} refs/heads/feat ${ZEROS}`;
    const cap = capture();
    let called = false;
    const code = await securityCli.run(["validate", "push"], {
      cwd: repo,
      env: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
      stdinData: stdin,
      jiraTransport: async () => {
        called = true;
        return { status: 200, exists: true };
      },
    });
    assert.equal(code, 0);
    assert.equal(called, false);
    const json = JSON.parse(cap.out);
    assert.equal(json.decision, "allow");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
