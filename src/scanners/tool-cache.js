"use strict";

/**
 * Cache verificada de binarios de herramientas (p. ej. Gitleaks).
 *
 * Garantías:
 *  - Nunca se ejecuta un binario cuyo SHA-256 no coincida con el pin del
 *    manifiesto.
 *  - La cache se direcciona por nombre/versión/arch + checksum, de modo que un
 *    binario corrupto o alterado no se reutiliza.
 *  - La descarga va a un archivo temporal, se verifica y sólo entonces se
 *    promueve atómicamente (rename). Un fallo deja la cache intacta.
 *  - En modo offline, si no hay cache válida, devuelve TOOL_UNAVAILABLE en vez
 *    de intentar red (requisitos 2.6, 23.7); nunca simula que escaneó.
 *
 * `downloader` se inyecta para pruebas deterministas (sin red real).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { findArtifact, PLACEHOLDER_RE, SHA256_RE } = require("./tool-manifest.js");

const STATUS = Object.freeze({
  OK: "ok",
  UNAVAILABLE: "unavailable",
  INTEGRITY_FAILED: "integrity_failed",
  INCOMPATIBLE: "incompatible",
});

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function defaultCacheRoot() {
  return path.join(os.homedir(), ".cache", "kiritek", "tools");
}

function cachePathFor(cacheRoot, toolName, version, platform, arch, sha256) {
  // El checksum entra en la ruta: un binario con otro contenido vive en otra
  // ruta y no "pisa" al verificado.
  const shortSha = sha256.slice(0, 16);
  return path.join(cacheRoot, toolName, `${version}-${platform}-${arch}-${shortSha}`, toolName);
}

/**
 * Resuelve un binario de herramienta verificado.
 *
 * @param {object} opts
 * @param {object} opts.manifest    Manifiesto ya cargado.
 * @param {string} opts.toolName    Nombre de la herramienta.
 * @param {string} opts.platform    process.platform.
 * @param {string} opts.arch        "x64" | "arm64".
 * @param {string} [opts.cacheRoot] Raíz de cache (default: ~/.cache/kiritek/tools).
 * @param {boolean} [opts.offline]  Si true, no intenta red.
 * @param {(url: string, destPath: string) => void} [opts.downloader]
 *        Descarga síncrona a destPath. Inyectable para pruebas.
 * @returns {{ status: string, binaryPath?: string, version?: string, reason?: string }}
 */
function resolveTool(opts) {
  const { manifest, toolName, platform, arch } = opts;
  const cacheRoot = opts.cacheRoot || defaultCacheRoot();
  const offline = !!opts.offline;

  const artifact = findArtifact(manifest, toolName, platform, arch);
  if (!artifact) {
    return { status: STATUS.INCOMPATIBLE, reason: `sin artefacto para ${platform}/${arch}` };
  }
  if (PLACEHOLDER_RE.test(artifact.sha256) || !SHA256_RE.test(artifact.sha256)) {
    // Pin pendiente/ inválido: no se puede verificar, no se ejecuta.
    return {
      status: STATUS.INTEGRITY_FAILED,
      reason: `pin de checksum no verificado para ${toolName} ${platform}/${arch}`,
    };
  }

  const target = cachePathFor(cacheRoot, toolName, artifact.version, platform, arch, artifact.sha256);

  // 1. ¿Ya está en cache y verifica?
  if (fs.existsSync(target)) {
    if (sha256File(target) === artifact.sha256) {
      return { status: STATUS.OK, binaryPath: target, version: artifact.version };
    }
    // Cache corrupta: se descarta, no se reutiliza.
    try {
      fs.rmSync(target, { force: true });
    } catch (_) {
      /* best-effort */
    }
  }

  if (offline) {
    return { status: STATUS.UNAVAILABLE, reason: "offline y sin cache verificada" };
  }
  if (typeof opts.downloader !== "function") {
    return { status: STATUS.UNAVAILABLE, reason: "sin downloader disponible" };
  }

  // 2. Descargar a temporal, verificar y promover atómicamente.
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${toolName}.${crypto.randomBytes(6).toString("hex")}.tmp`);

  try {
    opts.downloader(artifact.url, tmp);
  } catch (err) {
    cleanup(tmp);
    return { status: STATUS.UNAVAILABLE, reason: `descarga falló: ${err.message}` };
  }

  if (!fs.existsSync(tmp)) {
    return { status: STATUS.UNAVAILABLE, reason: "la descarga no produjo archivo" };
  }

  const actual = sha256File(tmp);
  if (actual !== artifact.sha256) {
    cleanup(tmp);
    return {
      status: STATUS.INTEGRITY_FAILED,
      reason: `checksum no coincide (esperado ${artifact.sha256.slice(0, 12)}…, obtenido ${actual.slice(0, 12)}…)`,
    };
  }

  fs.chmodSync(tmp, 0o700);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    cleanup(tmp);
    return { status: STATUS.UNAVAILABLE, reason: `no se pudo promover el binario: ${err.message}` };
  }

  return { status: STATUS.OK, binaryPath: target, version: artifact.version };
}

function cleanup(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch (_) {
    /* best-effort */
  }
}

module.exports = {
  STATUS,
  resolveTool,
  sha256File,
  cachePathFor,
  defaultCacheRoot,
};
