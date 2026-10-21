"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const proc = require("../../src/platform/process.js");
const pre = require("../../src/platform/preflight.js");
const paths = require("../../src/platform/paths.js");

// --- process.js: proxy/CA desde entorno sin tocar red ---

test("readProxyConfig: detecta proxy y CA y redacta credenciales embebidas", () => {
  const env = {
    HTTPS_PROXY: "http://user:secret@proxy.corp:8080",
    NO_PROXY: "localhost,127.0.0.1",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
  };
  const cfg = proc.readProxyConfig(env);
  assert.equal(cfg.anyProxy, true);
  assert.equal(cfg.httpsProxy.configured, true);
  assert.equal(cfg.httpsProxy.host, "proxy.corp:8080");
  // El usuario/clave NO deben aparecer.
  assert.equal(JSON.stringify(cfg).includes("secret"), false);
  assert.equal(cfg.noProxy.configured, true);
  assert.equal(cfg.extraCa.configured, true);
  assert.equal(cfg.extraCa.path, "/etc/ssl/corp.pem");
});

test("readProxyConfig: sin proxy devuelve anyProxy=false", () => {
  const cfg = proc.readProxyConfig({});
  assert.equal(cfg.anyProxy, false);
  assert.equal(cfg.extraCa.configured, false);
});

test("probeConnectivity: offline declarado no sondea red", () => {
  const r = proc.probeConnectivity({ offline: true, env: {} });
  assert.equal(r.status, "offline");
});

test("probeConnectivity: sin sonda inyectada → unknown (no asume red)", () => {
  const r = proc.probeConnectivity({ env: {} });
  assert.equal(r.status, "unknown");
});

test("probeConnectivity: sonda inyectada reachable → online", () => {
  const r = proc.probeConnectivity({ probe: () => ({ reachable: true, detail: "mock" }), env: {} });
  assert.equal(r.status, "online");
});

test("probeConnectivity: sonda que lanza → unreachable", () => {
  const r = proc.probeConnectivity({
    probe: () => {
      throw new Error("boom");
    },
    env: {},
  });
  assert.equal(r.status, "unreachable");
});

test("detectRuntime: reporta versión de Node y shell desde entorno POSIX", () => {
  const rt = proc.detectRuntime({ platform: "linux", env: { SHELL: "/bin/zsh" }, whichImpl: () => ({ found: false }) });
  assert.equal(rt.isWindows, false);
  assert.equal(rt.shell.name, "/bin/zsh");
  assert.ok(rt.node.major >= 18);
});

test("detectRuntime: Windows con pwsh disponible (which inyectado)", () => {
  const rt = proc.detectRuntime({
    platform: "win32",
    env: { ComSpec: "C:/Windows/System32/cmd.exe" },
    whichImpl: (bin) => ({ found: bin === "pwsh", path: bin === "pwsh" ? "C:/pwsh.exe" : null }),
  });
  assert.equal(rt.isWindows, true);
  assert.equal(rt.powershell.available, true);
  assert.equal(rt.powershell.flavor, "pwsh");
});

// --- preflight.js: read-only, hard vs soft ---

function okGitProbe() {
  return { ok: true, status: 0, stdout: "git version 2.43.0", stderr: "", error: null };
}
function okAccess() {
  /* escribible */
}
function okRepo() {
  return { ok: true, repoRoot: "/repo", gitDir: "/repo/.git", commonDir: "/repo/.git", isLinkedWorktree: false, insideWorkTree: true, reason: "ok" };
}

test("preflight: entorno sano en POSIX → canMutate true, sin hard failures", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    env: { SHELL: "/bin/bash" },
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: okRepo,
    accessImpl: okAccess,
  });
  assert.equal(res.canMutate, true);
  assert.equal(res.hardFailures.length, 0);
  assert.equal(res.readOnly, true);
});

test("preflight: Node por debajo del mínimo → hard failure que bloquea", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v16.0.0", major: 16 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: okRepo,
    accessImpl: okAccess,
  });
  assert.equal(res.canMutate, false);
  assert.ok(res.hardFailures.some((c) => c.id === "node"));
});

test("preflight: Git ausente → hard failure", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: () => ({ ok: false, status: 1, stdout: "", stderr: "not found", error: null }),
    gitRootImpl: okRepo,
    accessImpl: okAccess,
  });
  assert.equal(res.canMutate, false);
  assert.ok(res.hardFailures.some((c) => c.id === "git"));
});

test("preflight: arquitectura no soportada → hard failure (no simula escaneo)", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "ppc64",
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: okRepo,
    accessImpl: okAccess,
  });
  assert.equal(res.canMutate, false);
  assert.ok(res.hardFailures.some((c) => c.id === "arch"));
});

test("preflight: sin permiso de escritura → hard failure", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: okRepo,
    accessImpl: () => {
      throw new Error("EACCES");
    },
  });
  assert.equal(res.canMutate, false);
  assert.ok(res.hardFailures.some((c) => c.id === "permissions"));
});

test("preflight: Windows sin PowerShell → soft warning, no bloquea", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    runtime: {
      platform: "win32",
      isWindows: true,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "C:/cmd.exe", source: "ComSpec" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: okRepo,
    accessImpl: okAccess,
  });
  assert.equal(res.canMutate, true);
  assert.ok(res.warnings.some((c) => c.id === "shell"));
  // La plataforma Windows declara capacidades POSIX no disponibles.
  const platformCheck = res.checks.find((c) => c.id === "platform");
  assert.ok(platformCheck.detail.unavailableCapabilities.length > 0);
});

test("preflight: worktree enlazado se reporta en el check de repo", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: () => ({ ok: true, repoRoot: "/wt", gitDir: "/main/.git/worktrees/wt", commonDir: "/main/.git", isLinkedWorktree: true, insideWorkTree: true, reason: "ok" }),
    accessImpl: okAccess,
  });
  const repoCheck = res.checks.find((c) => c.id === "repo");
  assert.equal(repoCheck.detail.isLinkedWorktree, true);
});

test("preflight: offline no bloquea (cache/manual install, 23.7)", () => {
  const res = pre.preflight({
    repoRoot: "/repo",
    arch: "x64",
    offline: true,
    runtime: {
      platform: "linux",
      isWindows: false,
      node: { version: "v20.20.2", major: 20 },
      shell: { name: "/bin/bash", source: "SHELL" },
      powershell: { available: false, flavor: null },
    },
    gitVersionProbe: okGitProbe,
    gitRootImpl: okRepo,
    accessImpl: okAccess,
  });
  assert.equal(res.canMutate, true);
  const conn = res.checks.find((c) => c.id === "connectivity");
  assert.equal(conn.detail.status, "offline");
});

test("parseGitVersion: parsea variantes comunes", () => {
  assert.deepEqual(pre.parseGitVersion("git version 2.43.0").raw, "2.43.0");
  assert.equal(pre.parseGitVersion("git version 2.39").raw, "2.39.0");
  assert.equal(pre.parseGitVersion("no es git"), null);
});

// --- paths.js: utilidades puras y declaración de capacidades POSIX ---

test("posixCapabilities: POSIX disponibles; Windows declara no disponibles con razón", () => {
  const posix = paths.posixCapabilities("linux");
  assert.ok(posix.every((c) => c.available === true));

  const win = paths.posixCapabilities("win32");
  const symlink = win.find((c) => c.capability === "symlink");
  assert.equal(symlink.available, false);
  assert.ok(symlink.reason.length > 0);
});

test("normalizeLineEndings: convierte CRLF a LF e informa", () => {
  const r = paths.normalizeLineEndings("a\r\nb\r\n");
  assert.equal(r.normalized, "a\nb\n");
  assert.equal(r.hadCRLF, true);
  const r2 = paths.normalizeLineEndings("a\nb\n");
  assert.equal(r2.hadCRLF, false);
});

test("containRelative: ruta dentro del repo → relativa POSIX; fuera → lanza", () => {
  assert.equal(paths.containRelative("/repo", "/repo/sub/a.txt"), "sub/a.txt");
  assert.equal(paths.containRelative("/repo", "sub/a.txt"), "sub/a.txt");
  assert.throws(() => paths.containRelative("/repo", "/etc/passwd"), /fuera del repositorio/);
  assert.throws(() => paths.containRelative("/repo", "../x"), /fuera del repositorio/);
});

test("toPosixSeparators: normaliza separadores", () => {
  assert.equal(paths.toPosixSeparators(["a", "b", "c"].join(require("node:path").sep)), "a/b/c");
});
