"use strict";

/**
 * Permisos de plugins (T15B.2) y sandbox de ejecución.
 *
 * Rechazo de permisos excesivos al cargar:
 *  - filesystemRead: global (`**`), fuera del repo, `.git/**`, `.kiritek/**`;
 *  - networkHosts: comodines, IPs, `localhost`, con puerto/esquema;
 *  - envNames: comodines o nombres que parecen credenciales;
 *  - processes: no soportado (el sandbox prohíbe procesos hijo).
 *
 * Sandbox (`sandboxArgs`): modelo de permisos de Node (lectura sólo del
 * plugin, runner y rutas declaradas; escritura sólo en el temporal privado;
 * sin procesos hijo, workers ni bindings nativos) + guard de red del runner
 * que sólo permite los hosts declarados. Sin modelo de permisos disponible,
 * el plugin NO se ejecuta (nunca se corre sin aislamiento).
 */

const fs = require("node:fs");
const path = require("node:path");
const { raise } = require("../errors.js");
const { hasGlobChars } = require("../workspace/glob.js");

const RUNNER = path.join(__dirname, "plugin-runner.cjs");
const SECRET_ENV_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function assertPluginPermissions(control, pluginId) {
  const p = control.permissions;
  const bad = (what) => raise("PLUGIN_PERMISSIONS_EXCESSIVE", `${pluginId}: ${control.id} solicita ${what}`, { remediation: "Declare el mínimo necesario: rutas acotadas, hosts exactos y variables sin credenciales." });
  for (const g of p.filesystemRead) {
    if (["**", "*", "**/*", "."].includes(g) || /^\.git(\/|$)/.test(g) || /^\.kiritek(\/|$)/.test(g) || g.startsWith("../")) bad(`lectura excesiva "${g}"`);
  }
  for (const h of p.networkHosts) if (!HOST_RE.test(h) || h === "localhost") bad(`host de red no exacto "${h}"`);
  for (const e of p.envNames) if (!/^[A-Z][A-Z0-9_]*$/.test(e) || SECRET_ENV_RE.test(e)) bad(`variable de entorno sensible o comodín "${e}"`);
  if (p.processes.length) bad(`procesos (${p.processes.join(", ")}); los plugins no pueden lanzar procesos`);
}

/**
 * Flag del modelo de permisos, o null si no hay aislamiento confiable. En
 * Node < 22 el modelo bloquea la propia carga de módulos salvo con lectura
 * total del disco, que anula el aislamiento: ahí los plugins no se ejecutan.
 */
function permissionFlag(major = Number(process.versions.node.split(".")[0])) {
  if (major < 22) return null;
  const flags = process.allowedNodeEnvironmentFlags;
  if (flags.has("--permission")) return "--permission";
  if (flags.has("--experimental-permission")) return "--experimental-permission";
  return null;
}

/** Directorio literal (sin comodines) de un glob relativo al repo. */
function globBase(repoRoot, glob) {
  const lit = [];
  for (const seg of glob.split("/")) {
    if (hasGlobChars(seg)) break;
    lit.push(seg);
  }
  return path.join(repoRoot, ...lit);
}

/**
 * @param {object} o { pluginDir, repoRoot?, readGlobs?, tempDir?, hosts? }
 * @returns {string[]} flags de node para el proceso del plugin.
 */
function sandboxArgs(o) {
  const flag = permissionFlag();
  if (!flag) raise("PLUGIN_SANDBOX_UNAVAILABLE", `Node ${process.version} no ofrece modelo de permisos: los plugins no se ejecutan sin aislamiento`, { remediation: "Use Node ≥ 22 para ejecutar plugins (modelo de permisos con lectura acotada)." });
  const dirs = [o.pluginDir, path.dirname(RUNNER), ...(o.readGlobs || []).map((g) => globBase(o.repoRoot, g))];
  // El temporal se concede con su ruta tal cual (TMPDIR del hijo) y real
  // (p. ej. /var → /private/var en macOS): el modelo no resuelve symlinks.
  const temps = o.tempDir ? [...new Set([o.tempDir, fs.realpathSync(o.tempDir)])] : [];
  dirs.push(...temps);
  return [flag, ...fsFlags("--allow-fs-read", [...new Set(dirs)]), ...(temps.length ? fsFlags("--allow-fs-write", temps) : []), "--no-warnings"];
}

/**
 * Sintaxis por versión: Node ≥ 22 acepta el flag repetido (y rompe con
 * comas); Node 20 usa una lista con comas y `<dir>/*` para el contenido.
 */
function fsFlags(flag, dirs, major = Number(process.versions.node.split(".")[0])) {
  if (major >= 22) return dirs.map((d) => `${flag}=${d}`);
  return [`${flag}=${dirs.flatMap((d) => [d, `${d}/*`]).join(",")}`];
}

module.exports = { RUNNER, SECRET_ENV_RE, assertPluginPermissions, permissionFlag, sandboxArgs, fsFlags };
