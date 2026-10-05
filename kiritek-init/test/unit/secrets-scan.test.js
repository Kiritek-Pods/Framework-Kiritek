"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildArgs, ensureGitleaks, scanSecrets, mostSevere } = require("../../src/scanners/secrets-scan.js");

const BASE = { repoRoot: "/repo", configPath: "/repo/.kiritek/gitleaks.toml", reportPath: "/tmp/r.json" };

test("buildArgs: push escanea exactamente los commits del alcance", () => {
  const args = buildArgs("push", { ...BASE, commits: ["aaa", "bbb"] });
  assert.equal(args[0], "detect");
  assert.ok(args.includes("--log-opts=--no-walk aaa bbb"));
});

test("buildArgs: history completo por defecto y acotado con historyDepth numérico", () => {
  assert.equal(buildArgs("history", { ...BASE, historyDepth: "full" }).some((a) => a.startsWith("--log-opts")), false);
  assert.ok(buildArgs("history", { ...BASE, historyDepth: 50 }).includes("--log-opts=--max-count=50"));
});

test("buildArgs: .gitleaksignore del repo no aplica (apunta a .kiritek)", () => {
  const args = buildArgs("repository", BASE);
  assert.equal(args[args.indexOf("--gitleaks-ignore-path") + 1], path.join("/repo", ".kiritek"));
});

test("ensureGitleaks: offline sin cache → unavailable, nunca descarga", () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gl-"));
  try {
    let downloaded = false;
    const r = ensureGitleaks({
      repoRoot: "/nonexistent",
      offline: true,
      cacheRoot,
      platform: "linux",
      arch: "x64",
      downloader: () => { downloaded = true; },
    });
    assert.equal(r.status, "unavailable");
    assert.equal(downloaded, false);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("ensureGitleaks: checksum que no coincide → integrity_failed y no se cachea", () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gl-"));
  const prevOffline = process.env.KIRITEK_OFFLINE;
  delete process.env.KIRITEK_OFFLINE;
  try {
    const r = ensureGitleaks({
      repoRoot: "/nonexistent",
      cacheRoot,
      platform: "linux",
      arch: "x64",
      downloader: (url, dest) => fs.writeFileSync(dest, "binario alterado"),
    });
    assert.equal(r.status, "integrity_failed");
  } finally {
    if (prevOffline !== undefined) process.env.KIRITEK_OFFLINE = prevOffline;
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("scanSecrets: push sin commits no ejecuta la herramienta", () => {
  const r = scanSecrets({ repoRoot: "/repo", scope: "push", mode: "enforce", commits: [], deps: { exec: () => assert.fail("no debe ejecutar") } });
  assert.equal(r.result.decision, "allow");
  assert.equal(r.result.toolStatus, "not_applicable");
});

test("mostSevere: deny se antepone a error, error a warn", () => {
  const d = (decision) => ({ decision });
  assert.equal(mostSevere([d("error"), d("deny"), d("warn")]).decision, "deny");
  assert.equal(mostSevere([d("allow"), d("error"), d("warn")]).decision, "error");
});
