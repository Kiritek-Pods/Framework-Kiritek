"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const download = require("../../src/scanners/tool-download.js");
const runner = require("../../src/scanners/gitleaks-runner.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gl-"));
}
function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const SYNTHETIC = "AKIA" + "ABCDEFGHIJKLMNOP";

// --- tool-download: verificación de checksum del archivo antes de extraer ---

test("resolvePackagedTool: verifica checksum del archivo y extrae el binario", () => {
  const cacheRoot = tmpDir();
  try {
    const archiveBytes = Buffer.from("fake-archive-bytes");
    const digest = sha256(archiveBytes);
    const manifest = {
      schemaVersion: 1,
      tools: [
        {
          name: "gitleaks",
          version: "8.18.4",
          artifacts: [
            {
              platform: "linux",
              arch: "x64",
              url: "https://github.com/x.tar.gz",
              sha256: digest,
              archiveEntry: "gitleaks",
            },
          ],
        },
      ],
    };
    const downloader = (url, dest) => fs.writeFileSync(dest, archiveBytes);
    // Extractor simulado: produce el binario en destDir/entry.
    const extractor = (archive, entry, destDir) => {
      const out = path.join(destDir, entry);
      fs.writeFileSync(out, "#!/bin/sh\necho mock");
      return out;
    };
    const res = download.resolvePackagedTool({
      manifest,
      toolName: "gitleaks",
      platform: "linux",
      arch: "x64",
      cacheRoot,
      downloader,
      extractor,
    });
    assert.equal(res.status, download.STATUS.OK);
    assert.ok(fs.existsSync(res.binaryPath));
    assert.equal(res.version, "8.18.4");
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("resolvePackagedTool: checksum del archivo que no coincide → integrity_failed sin extraer", () => {
  const cacheRoot = tmpDir();
  try {
    const manifest = {
      schemaVersion: 1,
      tools: [
        {
          name: "gitleaks",
          version: "8.18.4",
          artifacts: [{ platform: "linux", arch: "x64", url: "https://github.com/x.tar.gz", sha256: "f".repeat(64), archiveEntry: "gitleaks" }],
        },
      ],
    };
    let extracted = false;
    const res = download.resolvePackagedTool({
      manifest,
      toolName: "gitleaks",
      platform: "linux",
      arch: "x64",
      cacheRoot,
      downloader: (url, dest) => fs.writeFileSync(dest, Buffer.from("otra-cosa")),
      extractor: () => {
        extracted = true;
        return "x";
      },
    });
    assert.equal(res.status, download.STATUS.INTEGRITY_FAILED);
    assert.equal(extracted, false, "no debe extraer si el checksum falla");
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("resolvePackagedTool: plataforma sin artefacto → incompatible", () => {
  const manifest = { schemaVersion: 1, tools: [{ name: "gitleaks", version: "8.18.4", artifacts: [] }] };
  const res = download.resolvePackagedTool({ manifest, toolName: "gitleaks", platform: "sunos", arch: "x64", cacheRoot: tmpDir() });
  assert.equal(res.status, download.STATUS.INCOMPATIBLE);
});

// --- gitleaks-runner: mapeo de exit codes y redacción ---

function execWith(status, stdout = "") {
  return () => ({ status, stdout, stderr: "", error: null });
}

test("runGitleaks: exit 0 → allow con evidencia", () => {
  const repo = tmpDir();
  try {
    const { result, evidence } = runner.runGitleaks({
      repoRoot: repo,
      binaryPath: "/bin/gitleaks",
      version: "8.18.4",
      configPath: "/no/existe.toml",
      mode: "enforce",
      scope: "staged",
      args: ["detect", "--staged"],
      exec: execWith(0),
    });
    assert.equal(result.decision, "allow");
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.toolVersion, "8.18.4");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("runGitleaks: exit 1 en enforce → deny con findings redactados", () => {
  const repo = tmpDir();
  try {
    const report = JSON.stringify([
      { RuleID: "aws-access-key", File: path.join(repo, "config/app.env"), StartLine: 12, Secret: SYNTHETIC, Match: `KEY=${SYNTHETIC}` },
    ]);
    const { result } = runner.runGitleaks({
      repoRoot: repo,
      binaryPath: "/bin/gitleaks",
      version: "8.18.4",
      configPath: "/no/existe.toml",
      mode: "enforce",
      scope: "staged",
      args: ["detect"],
      exec: execWith(1, report),
    });
    assert.equal(result.decision, "deny");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].path, "config/app.env");
    assert.equal(result.findings[0].ruleId, "aws-access-key");
    // No debe filtrar el secreto ni el match.
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(SYNTHETIC), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("runGitleaks: exit 1 en warning → warn", () => {
  const repo = tmpDir();
  try {
    const report = JSON.stringify([{ RuleID: "generic", File: path.join(repo, "a.txt"), StartLine: 1 }]);
    const { result } = runner.runGitleaks({
      repoRoot: repo,
      binaryPath: "/bin/gitleaks",
      version: "8.18.4",
      configPath: "/no/existe.toml",
      mode: "warning",
      scope: "staged",
      args: ["detect"],
      exec: execWith(1, report),
    });
    assert.equal(result.decision, "warn");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("runGitleaks: exit inesperado → error/unavailable, nunca allow", () => {
  const { result } = runner.runGitleaks({
    repoRoot: tmpDir(),
    binaryPath: "/bin/gitleaks",
    version: "8.18.4",
    configPath: "/no/existe.toml",
    mode: "enforce",
    scope: "staged",
    args: ["detect"],
    exec: execWith(2, ""),
  });
  assert.equal(result.decision, "error");
  assert.equal(result.toolStatus, "unavailable");
});

test("runGitleaks: fallo de ejecución (binario ausente) → error", () => {
  const { result } = runner.runGitleaks({
    repoRoot: tmpDir(),
    binaryPath: "/no/existe/gitleaks",
    version: "8.18.4",
    configPath: "/no/existe.toml",
    mode: "enforce",
    scope: "staged",
    args: ["detect"],
    exec: () => ({ status: null, stdout: "", stderr: "", error: new Error("ENOENT") }),
  });
  assert.equal(result.decision, "error");
});

test("gitleaks.toml de template existe y extiende los defaults", () => {
  const tpl = path.join(__dirname, "..", "..", "templates", "core", "security", "gitleaks", "gitleaks.toml");
  const content = fs.readFileSync(tpl, "utf8");
  assert.ok(content.includes("useDefault = true"));
});
