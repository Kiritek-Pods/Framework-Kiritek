"use strict";

/**
 * Utilidades de proceso multiplataforma.
 *
 * (Tarea 36.1–36.2, requisitos 23.1–23.2, 23.4, 23.7.)
 *
 * Principios:
 *  - SIEMPRE `spawnSync` con argumentos separados; nunca `shell:true` ni
 *    interpolar rutas/argumentos no confiables en una línea de comando.
 *  - La detección de shell/runtime es honesta: si una capacidad no está, se
 *    reporta no disponible con razón, no se simula.
 *  - El sondeo de conectividad/proxy/CA es INYECTABLE: en pruebas no se toca la
 *    red real. Por defecto sólo lee variables de entorno (proxy/CA) y marca la
 *    conectividad como "desconocida" salvo que se provea un probe.
 */

const { spawnSync } = require("child_process");

/**
 * Ejecuta un comando con argumentos separados (sin shell). Devuelve una forma
 * normalizada y nunca lanza por un exit code != 0.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [opts]  Opciones de spawnSync (cwd, env, encoding, timeout...).
 * @returns {{ ok: boolean, status: number|null, stdout: string, stderr: string, error: string|null }}
 */
function run(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, Array.isArray(args) ? args : [], {
    encoding: "utf8",
    timeout: opts.timeout || 15000,
    ...opts,
    shell: false, // nunca shell
  });
  if (res.error) {
    return { ok: false, status: null, stdout: "", stderr: "", error: String(res.error.message) };
  }
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: null,
  };
}

/**
 * ¿Existe un ejecutable en el PATH? Usa `where` en Windows y `command -v`/`which`
 * en POSIX, siempre con argumentos separados.
 *
 * @param {string} bin
 * @param {string} [platform=process.platform]
 */
function which(bin, platform) {
  const win = (platform || process.platform) === "win32";
  if (win) {
    const r = run("where", [bin]);
    const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
    return { found: r.ok && !!first, path: first, reason: r.ok ? "encontrado" : "no está en PATH" };
  }
  // POSIX: `command -v` es más portable que `which`, pero requiere un shell para
  // el builtin; usamos `/usr/bin/env` + el propio binario con --version como
  // sondeo no sería fiable. Preferimos `which` como ejecutable externo.
  const r = run("which", [bin]);
  const p = r.stdout.trim() || null;
  return { found: r.ok && !!p, path: p, reason: r.ok ? "encontrado" : "no está en PATH" };
}

/**
 * Detecta el shell/runtime disponible de forma honesta.
 *
 * @param {object} [opts] { platform, env }
 * @returns {{
 *   platform: string, isWindows: boolean,
 *   node: { version: string, major: number },
 *   shell: { name: string|null, source: string },
 *   powershell: { available: boolean, flavor: string|null }
 * }}
 */
function detectRuntime(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const win = platform === "win32";

  const version = process.version; // p. ej. v20.20.2
  const major = parseInt(String(version).replace(/^v/, "").split(".")[0], 10) || 0;

  let shellName = null;
  let shellSource = "ninguno";
  if (win) {
    if (env.ComSpec) {
      shellName = env.ComSpec;
      shellSource = "ComSpec";
    }
  } else if (env.SHELL) {
    shellName = env.SHELL;
    shellSource = "SHELL";
  }

  // PowerShell: sondeo honesto. Inyectable vía opts.whichImpl para pruebas.
  const whichImpl = opts.whichImpl || which;
  let powershell = { available: false, flavor: null };
  if (win) {
    const pwsh = whichImpl("pwsh", platform);
    if (pwsh.found) powershell = { available: true, flavor: "pwsh" };
    else {
      const legacy = whichImpl("powershell", platform);
      if (legacy.found) powershell = { available: true, flavor: "powershell" };
    }
  }

  return {
    platform,
    isWindows: win,
    node: { version, major },
    shell: { name: shellName, source: shellSource },
    powershell,
  };
}

/**
 * Lee la configuración de proxy y CA corporativa desde el entorno, sin tocar la
 * red. No imprime valores sensibles; sólo indica presencia y host/puerto
 * redactado cuando es seguro.
 *
 * @param {object} [env=process.env]
 */
function readProxyConfig(env = process.env) {
  const pick = (keys) => {
    for (const k of keys) {
      if (env[k] && String(env[k]).trim()) return { key: k, value: String(env[k]).trim() };
    }
    return null;
  };

  const httpsProxy = pick(["HTTPS_PROXY", "https_proxy"]);
  const httpProxy = pick(["HTTP_PROXY", "http_proxy"]);
  const noProxy = pick(["NO_PROXY", "no_proxy"]);
  const extraCa = pick(["NODE_EXTRA_CA_CERTS"]);

  // Redacción: no exponemos credenciales embebidas en la URL del proxy.
  const redactProxy = (v) => {
    if (!v) return null;
    try {
      const u = new URL(v.value);
      const host = u.host; // host:port sin userinfo
      return { configured: true, source: v.key, host };
    } catch (_) {
      return { configured: true, source: v.key, host: "(no parseable)" };
    }
  };

  return {
    httpsProxy: redactProxy(httpsProxy),
    httpProxy: redactProxy(httpProxy),
    noProxy: noProxy ? { configured: true, source: noProxy.key } : { configured: false },
    extraCa: extraCa ? { configured: true, source: extraCa.key, path: extraCa.value } : { configured: false },
    anyProxy: !!(httpsProxy || httpProxy),
  };
}

/**
 * Sondea conectividad de forma INYECTABLE. Por defecto NO toca la red: devuelve
 * estado "unknown" salvo que se provea `probe`. En modo offline declarado,
 * devuelve "offline" sin sondear.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.offline]  Modo offline declarado por el usuario.
 * @param {() => ({ reachable: boolean, detail?: string })} [opts.probe]
 *        Función de sondeo inyectada (p. ej. en producción, un HEAD a un host
 *        allowlisted). En pruebas se mockea; nunca red real por defecto.
 * @returns {{ status: "offline"|"online"|"unreachable"|"unknown", reason: string, proxy: object }}
 */
function probeConnectivity(opts = {}) {
  const proxy = readProxyConfig(opts.env);

  if (opts.offline) {
    return { status: "offline", reason: "modo offline declarado; se usará cache/instalación manual", proxy };
  }
  if (typeof opts.probe !== "function") {
    return {
      status: "unknown",
      reason: "sin sonda de conectividad inyectada; no se asume red (read-only)",
      proxy,
    };
  }
  let result;
  try {
    result = opts.probe();
  } catch (err) {
    return { status: "unreachable", reason: `sonda falló: ${err.message}`, proxy };
  }
  if (result && result.reachable) {
    return { status: "online", reason: result.detail || "sonda OK", proxy };
  }
  return { status: "unreachable", reason: (result && result.detail) || "sonda reportó inalcanzable", proxy };
}

module.exports = {
  run,
  which,
  detectRuntime,
  readProxyConfig,
  probeConnectivity,
};
