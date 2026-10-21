"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const manifestMod = require("../../src/scanners/tool-manifest.js");
const toolCache = require("../../src/scanners/tool-cache.js");
const { buildToolInventory } = require("../../src/scanners/sbom.js");

const REAL_MANIFEST = path.join(__dirname, "..", "..", "templates", "core", "security", "tools", "manifest.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(REAL_MANIFEST, "utf8"));
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-tool-"));
}

test("manifiesto real: schema válido, política OK y checksums reales fijados", () => {
  const res = manifestMod.validateManifest(readManifest());
  assert.deepEqual(res.errors, [], "no debe haber errores de política");
  assert.equal(res.valid, true);
  // Los checksums de Gitleaks 8.18.4 ya están fijados con hashes reales.
  assert.equal(res.pendingPins.length, 0, "no deben quedar pins pendientes");
});

test("validateManifest: rechaza latest, rango y tag mutable", () => {
  for (const bad of ["latest", "^8.18.0", "8.x", "main"]) {
    const m = { schemaVersion: 1, tools: [{ name: "t", version: bad, artifacts: [] }] };
    assert.equal(manifestMod.validateManifest(m).valid, false, `${bad} debe ser inválido`);
  }
});

test("validateManifest: rechaza URL no HTTPS o host no permitido", () => {
  const m = {
    schemaVersion: 1,
    tools: [
      {
        name: "t",
        version: "1.0.0",
        artifacts: [
          { platform: "linux", arch: "x64", url: "http://github.com/x.tgz", sha256: "a".repeat(64) },
          { platform: "darwin", arch: "x64", url: "https://evil.example.com/x.tgz", sha256: "b".repeat(64) },
        ],
      },
    ],
  };
  const res = manifestMod.validateManifest(m);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /URL no permitida/.test(e)));
});

test("validateManifest: rechaza plataforma/arquitectura duplicada", () => {
  const m = {
    schemaVersion: 1,
    tools: [
      {
        name: "t",
        version: "1.0.0",
        artifacts: [
          { platform: "linux", arch: "x64", url: "https://github.com/a.tgz", sha256: "a".repeat(64) },
          { platform: "linux", arch: "x64", url: "https://github.com/b.tgz", sha256: "b".repeat(64) },
        ],
      },
    ],
  };
  assert.equal(manifestMod.validateManifest(m).valid, false);
});

test("resolveTool: incompatible si no hay artefacto para la plataforma", () => {
  const res = toolCache.resolveTool({
    manifest: readManifest(),
    toolName: "gitleaks",
    platform: "sunos",
    arch: "x64",
  });
  assert.equal(res.status, toolCache.STATUS.INCOMPATIBLE);
});

test("resolveTool: pin placeholder produce integrity_failed (no ejecuta)", () => {
  const manifestWithPlaceholder = {
    schemaVersion: 1,
    tools: [
      {
        name: "demo",
        version: "1.0.0",
        artifacts: [
          {
            platform: "linux",
            arch: "x64",
            url: "https://github.com/demo.tgz",
            sha256: "REPLACE_WITH_VERIFIED_SHA256_linux_x64",
          },
        ],
      },
    ],
  };
  const res = toolCache.resolveTool({
    manifest: manifestWithPlaceholder,
    toolName: "demo",
    platform: "linux",
    arch: "x64",
    cacheRoot: tmpDir(),
  });
  assert.equal(res.status, toolCache.STATUS.INTEGRITY_FAILED);
});

test("resolveTool: manifiesto real de gitleaks ya no tiene pin placeholder", () => {
  // Con checksums reales, el estado ya no es integrity_failed por placeholder;
  // en offline sin cache será unavailable (no se intenta red en tests).
  const res = toolCache.resolveTool({
    manifest: readManifest(),
    toolName: "gitleaks",
    platform: "linux",
    arch: "x64",
    cacheRoot: tmpDir(),
    offline: true,
  });
  assert.equal(res.status, toolCache.STATUS.UNAVAILABLE);
});

test("resolveTool: offline sin cache devuelve unavailable", () => {
  const cacheRoot = tmpDir();
  const content = Buffer.from("fake-binary");
  const digest = sha256(content);
  const manifest = {
    schemaVersion: 1,
    tools: [
      {
        name: "demo",
        version: "1.0.0",
        artifacts: [{ platform: "linux", arch: "x64", url: "https://github.com/demo.bin", sha256: digest }],
      },
    ],
  };
  try {
    const res = toolCache.resolveTool({ manifest, toolName: "demo", platform: "linux", arch: "x64", cacheRoot, offline: true });
    assert.equal(res.status, toolCache.STATUS.UNAVAILABLE);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("resolveTool: descarga verificada OK y reutiliza cache", () => {
  const cacheRoot = tmpDir();
  const content = Buffer.from("fake-binary-contents");
  const digest = sha256(content);
  const manifest = {
    schemaVersion: 1,
    tools: [
      {
        name: "demo",
        version: "1.0.0",
        artifacts: [{ platform: "linux", arch: "x64", url: "https://github.com/demo.bin", sha256: digest }],
      },
    ],
  };
  let downloads = 0;
  const downloader = (url, destPath) => {
    downloads += 1;
    fs.writeFileSync(destPath, content);
  };
  try {
    const r1 = toolCache.resolveTool({ manifest, toolName: "demo", platform: "linux", arch: "x64", cacheRoot, downloader });
    assert.equal(r1.status, toolCache.STATUS.OK);
    assert.ok(fs.existsSync(r1.binaryPath));
    // Segunda vez: usa cache, no vuelve a descargar.
    const r2 = toolCache.resolveTool({ manifest, toolName: "demo", platform: "linux", arch: "x64", cacheRoot, downloader });
    assert.equal(r2.status, toolCache.STATUS.OK);
    assert.equal(downloads, 1);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("resolveTool: checksum que no coincide produce integrity_failed y no promueve", () => {
  const cacheRoot = tmpDir();
  const manifest = {
    schemaVersion: 1,
    tools: [
      {
        name: "demo",
        version: "1.0.0",
        artifacts: [{ platform: "linux", arch: "x64", url: "https://github.com/demo.bin", sha256: "f".repeat(64) }],
      },
    ],
  };
  const downloader = (url, destPath) => fs.writeFileSync(destPath, Buffer.from("otra-cosa"));
  try {
    const res = toolCache.resolveTool({ manifest, toolName: "demo", platform: "linux", arch: "x64", cacheRoot, downloader });
    assert.equal(res.status, toolCache.STATUS.INTEGRITY_FAILED);
    // No debe quedar el binario promovido ni temporales.
    const toolDir = path.join(cacheRoot, "demo");
    const leftover = fs.existsSync(toolDir)
      ? fs.readdirSync(toolDir, { recursive: true }).filter((f) => String(f).endsWith(".tmp"))
      : [];
    assert.equal(leftover.length, 0);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("resolveTool: cache corrupta no se reutiliza (se re-descarga)", () => {
  const cacheRoot = tmpDir();
  const content = Buffer.from("good-binary");
  const digest = sha256(content);
  const manifest = {
    schemaVersion: 1,
    tools: [
      {
        name: "demo",
        version: "1.0.0",
        artifacts: [{ platform: "linux", arch: "x64", url: "https://github.com/demo.bin", sha256: digest }],
      },
    ],
  };
  try {
    // Sembrar cache con contenido corrupto en la ruta esperada.
    const target = toolCache.cachePathFor(cacheRoot, "demo", "1.0.0", "linux", "x64", digest);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from("CORRUPT"));
    const downloader = (url, destPath) => fs.writeFileSync(destPath, content);
    const res = toolCache.resolveTool({ manifest, toolName: "demo", platform: "linux", arch: "x64", cacheRoot, downloader });
    assert.equal(res.status, toolCache.STATUS.OK);
    assert.equal(sha256(fs.readFileSync(res.binaryPath)), digest);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("sbom: inventario sólo de componentes inspeccionados", () => {
  const inv = buildToolInventory(readManifest(), { now: () => "2026-10-01T00:00:00.000Z" });
  assert.equal(inv.scope, "distributed-tools-only");
  assert.ok(inv.components.length >= 1);
  assert.ok(inv.components.every((c) => c.name && c.version && c.platform && c.arch));
});

test("análisis estático: el código de scanners no usa 'curl | sh' ni tags mutables en descargas", () => {
  const dir = path.join(__dirname, "..", "..", "src", "scanners");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.equal(/curl\s+[^\n]*\|\s*sh/.test(src), false, `${f} no debe usar curl | sh`);
    assert.equal(/releases\/download\/latest/.test(src), false, `${f} no debe apuntar a releases 'latest'`);
  }
});
