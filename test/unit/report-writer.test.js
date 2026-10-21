"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeReport, ignoreEntries, DEFAULT_REPORT_DIR } = require("../../src/scanners/report-writer.js");
const fingerprint = require("../../src/scanners/fingerprint.js");
const result = require("../../src/domain/result.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-report-"));
}

test("fingerprint: hashSecret estable y no reversible al valor", () => {
  const h1 = fingerprint.hashSecret("super-secret-value");
  const h2 = fingerprint.hashSecret("super-secret-value");
  assert.equal(h1, h2);
  assert.equal(h1.length, 16);
  assert.ok(!h1.includes("secret"));
});

test("normalizeRepoPath: relativiza y rechaza escapes", () => {
  const root = "/repo";
  assert.equal(fingerprint.normalizeRepoPath(root, "/repo/src/a.js"), "src/a.js");
  assert.equal(fingerprint.normalizeRepoPath(root, "src/a.js"), "src/a.js");
  assert.throws(() => fingerprint.normalizeRepoPath(root, "/etc/passwd"), /fuera del repositorio/);
  assert.throws(() => fingerprint.normalizeRepoPath(root, "../outside.txt"), /fuera del repositorio/);
});

test("buildFingerprint: estable e incluye hash del secreto sin el valor", () => {
  const fp = fingerprint.buildFingerprint({ path: "a.env", ruleId: "aws", lineNumber: 3, secret: "AKIAZ" });
  assert.ok(fp.startsWith("a.env:aws:3:"));
  assert.ok(!fp.includes("AKIAZ"));
});

test("writeReport: escribe JSON schema-valid de forma atómica", () => {
  const repo = tmpRepo();
  try {
    const r = result.createResult({
      controlId: "secrets.gitleaks",
      decision: "deny",
      reason: "secreto detectado",
      severity: "critical",
      toolStatus: "ok",
      findings: [{ ruleId: "aws", path: "a.env", severity: "critical", fingerprint: "a.env:aws:1" }],
    });
    const { jsonPath, bytes } = writeReport({
      repoRoot: repo,
      name: "scan-staged",
      value: r,
      schemaName: "result",
    });
    assert.ok(fs.existsSync(jsonPath));
    assert.ok(bytes > 0);
    const written = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(written.decision, "deny");
    // No deben quedar temporales
    const dir = path.join(repo, DEFAULT_REPORT_DIR);
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeReport: rechaza objeto que no cumple schema (no escribe)", () => {
  const repo = tmpRepo();
  try {
    assert.throws(
      () =>
        writeReport({
          repoRoot: repo,
          name: "bad",
          value: { schemaVersion: 1, controlId: "c", decision: "nope", severity: "info", toolStatus: "ok", findings: [] },
          schemaName: "result",
        }),
      (err) => err.code === "SCHEMA_INVALID"
    );
    const dir = path.join(repo, DEFAULT_REPORT_DIR);
    assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeReport: nombre inseguro es rechazado", () => {
  const repo = tmpRepo();
  try {
    assert.throws(() => writeReport({ repoRoot: repo, name: "../escape", value: {} }), /identificador simple/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("ignoreEntries: devuelve el directorio de reportes con barra final", () => {
  assert.deepEqual(ignoreEntries(), [".kiritek/security/"]);
  assert.deepEqual(ignoreEntries("reports/sec/"), ["reports/sec/"]);
});
