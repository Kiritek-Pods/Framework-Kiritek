"use strict";

/**
 * Ejecución aislada de herramientas (T07.1).
 *
 * - `spawn(file, args, {shell:false})`: argumentos nunca pasan por shell.
 * - cwd confinado al repo real; entorno mínimo allowlisted; temporal propio
 *   borrado siempre (también ante timeout o error).
 * - Timeout y límite de memoria matan el ÁRBOL de procesos (grupo POSIX /
 *   `taskkill /T` en Windows), no sólo el hijo directo.
 * - Salida acotada (`maxOutputBytes`); el resultado nunca se interpreta como
 *   decisión: es materia prima para un collector.
 */

const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { buildEnv, confineCwd } = require("./sandbox.js");
const { createTempWorkspace } = require("./temp-cleanup.js");

const RUN_STATUS = Object.freeze({
  OK: "ok",
  NONZERO: "nonzero",
  TIMEOUT: "timeout",
  RESOURCE: "resource",
  SPAWN_ERROR: "spawn-error",
});

const IS_WIN = process.platform === "win32";

function killTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch (_) {
    try {
      child.kill("SIGKILL");
    } catch (__) {
      /* ya terminó */
    }
  }
}

/** RSS total (MB) del grupo de procesos en POSIX; null si no se puede medir. */
function sampleGroupRssMb(pgid) {
  if (IS_WIN) return null;
  try {
    const out = execFileSync("ps", ["-A", "-o", "pgid=,rss="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    let kb = 0;
    for (const line of out.split("\n")) {
      const [g, rss] = line.trim().split(/\s+/);
      if (Number(g) === pgid) kb += Number(rss) || 0;
    }
    return kb / 1024;
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.command          Ejecutable (sin shell).
 * @param {string[]|((tempDir: string) => string[])} [opts.args]  Función ⇒ args según el temporal privado (sandbox de plugins).
 * @param {string} opts.repoRoot
 * @param {string} [opts.cwd]            Relativo al repo.
 * @param {Record<string,string>} [opts.sourceEnv]
 * @param {string[]} [opts.envAllowlist]
 * @param {boolean} [opts.network]
 * @param {number} opts.timeoutMs
 * @param {number} [opts.maxOutputBytes]
 * @param {number} [opts.maxMemoryMb]
 * @param {(pgid:number) => number|null} [opts.sampleRssMb]
 * @param {number} [opts.sampleIntervalMs]
 * @returns {Promise<{status, exitCode, signal, stdout, stderr, truncated, durationMs, pid, tempCleaned}>}
 */
function runTool(opts) {
  const started = Date.now();
  const cwd = confineCwd(opts.repoRoot, opts.cwd || ".");
  const temp = createTempWorkspace();
  let env;
  try {
    env = buildEnv({ source: opts.sourceEnv || process.env, allowlist: opts.envAllowlist, network: opts.network, tempDir: temp.dir, permittedSecrets: opts.permittedSecrets });
  } catch (e) {
    temp.cleanup();
    throw e;
  }
  const maxOut = opts.maxOutputBytes || 1024 * 1024;

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let status = null;
    let truncated = false;
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    const timers = [];

    const finish = (base) => {
      if (settled) return;
      settled = true;
      timers.forEach((t) => clearInterval(t));
      const tempCleaned = temp.cleanup();
      resolve({
        status: base.status,
        exitCode: base.exitCode === undefined ? null : base.exitCode,
        signal: base.signal || null,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        truncated,
        durationMs: Date.now() - started,
        pid: child ? child.pid : null,
        tempCleaned,
      });
    };

    try {
      const args = typeof opts.args === "function" ? opts.args(temp.dir) : opts.args || [];
      child = spawn(opts.command, args, { cwd, env, shell: false, detached: !IS_WIN, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      finish({ status: RUN_STATUS.SPAWN_ERROR });
      return;
    }
    const capture = (chunks, isOut) => (buf) => {
      const used = isOut ? outBytes : errBytes;
      if (used >= maxOut) {
        truncated = true;
        return;
      }
      const slice = buf.subarray(0, maxOut - used);
      if (slice.length < buf.length) truncated = true;
      chunks.push(slice);
      if (isOut) outBytes += slice.length;
      else errBytes += slice.length;
    };
    child.stdout.on("data", capture(out, true));
    child.stderr.on("data", capture(err, false));
    child.on("error", () => finish({ status: RUN_STATUS.SPAWN_ERROR }));
    child.on("close", (code, signal) => {
      finish({ status: status || (code === 0 ? RUN_STATUS.OK : RUN_STATUS.NONZERO), exitCode: code, signal });
    });

    const timeout = setTimeout(() => {
      status = RUN_STATUS.TIMEOUT;
      killTree(child);
    }, opts.timeoutMs);
    timers.push(timeout);
    if (opts.maxMemoryMb) {
      const sampler = opts.sampleRssMb || sampleGroupRssMb;
      const interval = setInterval(() => {
        const mb = sampler(child.pid);
        if (mb !== null && mb > opts.maxMemoryMb) {
          status = RUN_STATUS.RESOURCE;
          killTree(child);
        }
      }, opts.sampleIntervalMs || 200);
      timers.push(interval);
    }
  });
}

/** ¿Sigue vivo un pid? (para pruebas de kill de árbol). */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

module.exports = { RUN_STATUS, runTool, killTree, isAlive, sampleGroupRssMb };
