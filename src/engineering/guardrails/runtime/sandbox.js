"use strict";

/**
 * Entorno mínimo y cwd confinado para herramientas externas (T07.1; design
 * §3.2). El workspace no es confiable: nada se ejecuta por shell, el cwd
 * debe quedar dentro del repo real y el entorno se construye desde cero con
 * una allowlist. Variables con forma de credencial nunca pasan salvo
 * permiso explícito del control.
 */

const { containReal } = require("../../../platform/paths.js");
const { raise } = require("../errors.js");

const BASE_ENV = Object.freeze(["PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "SYSTEMROOT", "COMSPEC", "PATHEXT"]);
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|AUTH|SESSION|COOKIE)/i;
const NETWORK_ENV = Object.freeze(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]);

/**
 * @param {object} opts
 * @param {Record<string,string>} opts.source   Entorno origen (process.env).
 * @param {string[]} [opts.allowlist]           Nombres adicionales permitidos (permisos del control).
 * @param {boolean} [opts.network]              Si el control tiene permiso de red (pasa proxy/CA).
 * @param {string} [opts.tempDir]               Temporal propio (TMPDIR/TEMP/TMP).
 */
function buildEnv(opts) {
  const source = opts.source || {};
  for (const name of opts.allowlist || []) {
    if (SECRET_NAME_RE.test(name) && !(opts.permittedSecrets || []).includes(name)) {
      raise("RUNTIME_ENV_SECRET", `la variable ${name} tiene forma de credencial y no está permitida explícitamente`, {
        remediation: "Declare la variable en permissions.envNames del control y en la trust policy; nunca se hereda implícitamente.",
      });
    }
  }
  const env = {};
  const names = new Set([...BASE_ENV, ...(opts.allowlist || []), ...(opts.network ? NETWORK_ENV : [])]);
  for (const name of names) {
    if (source[name] === undefined) continue;
    if (SECRET_NAME_RE.test(name) && !(opts.allowlist || []).includes(name)) continue;
    env[name] = source[name];
  }
  if (opts.tempDir) {
    env.TMPDIR = opts.tempDir;
    env.TEMP = opts.tempDir;
    env.TMP = opts.tempDir;
  }
  env.KIRITEK_SANDBOX = "1";
  return env;
}

/** cwd relativo al repo → ruta real confinada. */
function confineCwd(repoRoot, relCwd = ".") {
  const res = containReal(repoRoot, relCwd === "." ? repoRoot : relCwd);
  if (!res.contained) {
    raise("RUNTIME_CWD_OUTSIDE_REPO", "el directorio de trabajo de la herramienta resuelve fuera del repositorio");
  }
  return res.realPath;
}

module.exports = { BASE_ENV, NETWORK_ENV, buildEnv, confineCwd };
