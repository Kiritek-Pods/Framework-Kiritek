"use strict";

/**
 * Preflight de compatibilidad — se ejecuta ANTES de cualquier mutación.
 *
 * (Tarea 36.1, requisitos 23.1–23.7, 26.2, 26.7, G.14.)
 *
 * Contrato:
 *  - Es READ-ONLY: no escribe ni muta el repositorio. Sólo observa.
 *  - Valida: versión de Node, presencia/versión de Git, shell/runtime,
 *    permisos de escritura, arquitectura, conectividad/proxy/CA y
 *    compatibilidad de plataforma.
 *  - Devuelve un resultado ESTRUCTURADO por check con severidad honesta:
 *      · "hard"  → incompatibilidad dura: BLOQUEA la mutación.
 *      · "soft"  → advertencia: la mutación puede continuar con aviso.
 *      · "ok"    → sin problemas.
 *  - `canMutate` es false si existe cualquier check "hard".
 *  - Nunca simula una capacidad: si algo no se puede verificar, lo dice.
 *
 * Las sondas externas (Git, conectividad) son inyectables para pruebas
 * deterministas sin red real.
 */

const fs = require("fs");
const path = require("path");

const platformProc = require("./process.js");
const platformPaths = require("./paths.js");

const MIN_NODE_MAJOR = 18;

/** Arquitecturas soportadas por las herramientas fijadas (Gitleaks, etc.). */
const SUPPORTED_ARCH = Object.freeze(["x64", "arm64"]);
/** Plataformas con subconjunto declarado compatible. */
const SUPPORTED_PLATFORMS = Object.freeze(["darwin", "linux", "win32"]);

const SEVERITY = Object.freeze({ OK: "ok", SOFT: "soft", HARD: "hard" });

function mkCheck(id, severity, message, detail) {
  return { id, severity, message, detail: detail || null };
}

/**
 * Parsea `git version 2.43.0` → { major, minor, patch, raw }.
 */
function parseGitVersion(stdout) {
  const m = String(stdout || "").match(/git version (\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] ? parseInt(m[3], 10) : 0,
    raw: `${m[1]}.${m[2]}.${m[3] || 0}`,
  };
}

function checkNode(ctx) {
  const major = ctx.node.major;
  if (!major) {
    return mkCheck("node", SEVERITY.HARD, "no se pudo determinar la versión de Node", { version: ctx.node.version });
  }
  if (major < MIN_NODE_MAJOR) {
    return mkCheck(
      "node",
      SEVERITY.HARD,
      `Node ${ctx.node.version} no soportado; se requiere Node >= ${MIN_NODE_MAJOR}`,
      { version: ctx.node.version, required: `>=${MIN_NODE_MAJOR}` }
    );
  }
  return mkCheck("node", SEVERITY.OK, `Node ${ctx.node.version} soportado`, { version: ctx.node.version });
}

function checkGit(opts) {
  // Inyectable: opts.gitVersionProbe() -> { ok, stdout }
  const probe = opts.gitVersionProbe || (() => platformProc.run("git", ["--version"]));
  let res;
  try {
    res = probe();
  } catch (err) {
    return mkCheck("git", SEVERITY.HARD, "no se pudo invocar Git", { error: err.message });
  }
  if (!res || !res.ok) {
    return mkCheck("git", SEVERITY.HARD, "Git no está disponible en el PATH", {
      reason: (res && (res.error || res.stderr)) || "git --version falló",
    });
  }
  const ver = parseGitVersion(res.stdout);
  if (!ver) {
    return mkCheck("git", SEVERITY.SOFT, "Git disponible pero no se pudo parsear su versión", {
      stdout: String(res.stdout).trim().slice(0, 80),
    });
  }
  // Git >= 2.5 trae worktrees; muy antiguo es una advertencia, no un bloqueo
  // duro, porque la mayoría de operaciones básicas siguen funcionando.
  if (ver.major < 2 || (ver.major === 2 && ver.minor < 5)) {
    return mkCheck("git", SEVERITY.SOFT, `Git ${ver.raw} es antiguo; worktrees pueden no funcionar`, { version: ver.raw });
  }
  return mkCheck("git", SEVERITY.OK, `Git ${ver.raw} disponible`, { version: ver.raw });
}

function checkShellRuntime(ctx) {
  if (ctx.runtime.isWindows) {
    if (ctx.runtime.powershell.available) {
      return mkCheck("shell", SEVERITY.OK, `runtime Windows con ${ctx.runtime.powershell.flavor}`, {
        powershell: ctx.runtime.powershell.flavor,
      });
    }
    // En Windows sin PowerShell dependemos del shim Node; es viable pero se avisa.
    return mkCheck(
      "shell",
      SEVERITY.SOFT,
      "Windows sin PowerShell detectado; se usarán shims Node (capacidades POSIX no asumidas)",
      { comSpec: ctx.runtime.shell.name }
    );
  }
  if (ctx.runtime.shell.name) {
    return mkCheck("shell", SEVERITY.OK, `shell POSIX ${ctx.runtime.shell.name}`, { source: ctx.runtime.shell.source });
  }
  return mkCheck("shell", SEVERITY.SOFT, "sin SHELL en el entorno; los hooks se invocan vía Node", null);
}

function checkArch(arch) {
  const a = arch || process.arch;
  if (!SUPPORTED_ARCH.includes(a)) {
    return mkCheck(
      "arch",
      SEVERITY.HARD,
      `arquitectura ${a} sin binarios fijados; no se simulará el escaneo`,
      { arch: a, supported: SUPPORTED_ARCH }
    );
  }
  return mkCheck("arch", SEVERITY.OK, `arquitectura ${a} soportada`, { arch: a });
}

function checkPlatform(ctx) {
  const p = ctx.runtime.platform;
  if (!SUPPORTED_PLATFORMS.includes(p)) {
    return mkCheck("platform", SEVERITY.HARD, `plataforma ${p} fuera del subconjunto soportado`, {
      platform: p,
      supported: SUPPORTED_PLATFORMS,
    });
  }
  // Declarar explícitamente las capacidades POSIX no soportadas (no bloquea).
  const caps = platformPaths.posixCapabilities(p);
  const unavailable = caps.filter((c) => !c.available);
  if (unavailable.length) {
    return mkCheck(
      "platform",
      SEVERITY.SOFT,
      `plataforma ${p} soportada con capacidades POSIX limitadas`,
      { platform: p, unavailableCapabilities: unavailable }
    );
  }
  return mkCheck("platform", SEVERITY.OK, `plataforma ${p} con capacidades POSIX completas`, { platform: p });
}

/**
 * Verifica permiso de ESCRITURA sin mutar el repo: usa fs.accessSync(W_OK)
 * sobre la raíz. No crea ni borra archivos.
 */
function checkPermissions(repoRoot, opts) {
  const accessImpl = opts.accessImpl || ((p, mode) => fs.accessSync(p, mode));
  if (!repoRoot) {
    return mkCheck("permissions", SEVERITY.SOFT, "sin repoRoot: permisos no verificados", null);
  }
  try {
    accessImpl(repoRoot, fs.constants.W_OK);
    return mkCheck("permissions", SEVERITY.OK, "directorio del repo es escribible", { repoRoot });
  } catch (err) {
    return mkCheck("permissions", SEVERITY.HARD, "sin permiso de escritura en el repo", {
      repoRoot,
      error: err.message,
    });
  }
}

function checkRepo(repoRoot, opts) {
  // Inyectable: opts.gitRootImpl(startDir) -> resolveGitRoot result
  const impl = opts.gitRootImpl || platformPaths.resolveGitRoot;
  if (!repoRoot) {
    return { check: mkCheck("repo", SEVERITY.SOFT, "sin repoRoot: resolución Git omitida", null), repo: null };
  }
  const r = impl(repoRoot);
  if (!r.ok) {
    return {
      check: mkCheck("repo", SEVERITY.SOFT, "el directorio no es un worktree Git", { reason: r.reason }),
      repo: r,
    };
  }
  const detail = {
    repoRoot: r.repoRoot,
    isLinkedWorktree: r.isLinkedWorktree,
    gitDir: r.gitDir,
    commonDir: r.commonDir,
  };
  const msg = r.isLinkedWorktree ? "worktree enlazado resuelto correctamente" : "raíz Git resuelta";
  return { check: mkCheck("repo", SEVERITY.OK, msg, detail), repo: r };
}

function checkConnectivity(opts) {
  const conn = platformProc.probeConnectivity({
    offline: opts.offline,
    probe: opts.connectivityProbe,
    env: opts.env,
  });
  // offline / unknown no bloquean: hay cache / instalación manual (23.7).
  if (conn.status === "unreachable") {
    return mkCheck("connectivity", SEVERITY.SOFT, "red inalcanzable; se usará cache/instalación manual", conn);
  }
  if (conn.status === "offline") {
    return mkCheck("connectivity", SEVERITY.OK, "modo offline: cache/fuentes configuradas", conn);
  }
  if (conn.status === "online") {
    return mkCheck("connectivity", SEVERITY.OK, "conectividad verificada", conn);
  }
  return mkCheck("connectivity", SEVERITY.OK, "conectividad desconocida (no se asume red)", conn);
}

/**
 * Ejecuta el preflight completo (read-only).
 *
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]           Raíz candidata (para permisos/repo).
 * @param {boolean} [opts.offline]           Modo offline declarado.
 * @param {string} [opts.arch=process.arch]
 * @param {object} [opts.env=process.env]
 * @param {() => object} [opts.gitVersionProbe]      Inyectable (sin red).
 * @param {(d) => object} [opts.gitRootImpl]         Inyectable.
 * @param {() => object} [opts.connectivityProbe]    Inyectable (sin red).
 * @param {(p,mode) => void} [opts.accessImpl]       Inyectable (permisos).
 * @param {object} [opts.runtime]            Runtime pre-detectado (tests).
 * @returns {{
 *   canMutate: boolean,
 *   hardFailures: object[],
 *   warnings: object[],
 *   checks: object[],
 *   runtime: object,
 *   repo: object|null,
 *   readOnly: true
 * }}
 */
function preflight(opts = {}) {
  const runtime = opts.runtime || platformProc.detectRuntime({ env: opts.env, platform: opts.platform });
  const ctx = { node: runtime.node, runtime };

  const checks = [];
  checks.push(checkNode(ctx));
  checks.push(checkGit(opts));
  checks.push(checkShellRuntime(ctx));
  checks.push(checkArch(opts.arch));
  checks.push(checkPlatform(ctx));
  checks.push(checkPermissions(opts.repoRoot, opts));

  const repoResult = checkRepo(opts.repoRoot, opts);
  checks.push(repoResult.check);

  checks.push(checkConnectivity(opts));

  const hardFailures = checks.filter((c) => c.severity === SEVERITY.HARD);
  const warnings = checks.filter((c) => c.severity === SEVERITY.SOFT);

  return {
    canMutate: hardFailures.length === 0,
    hardFailures,
    warnings,
    checks,
    runtime,
    repo: repoResult.repo,
    readOnly: true,
  };
}

module.exports = {
  MIN_NODE_MAJOR,
  SUPPORTED_ARCH,
  SUPPORTED_PLATFORMS,
  SEVERITY,
  parseGitVersion,
  preflight,
};
