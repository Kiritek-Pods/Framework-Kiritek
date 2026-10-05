"use strict";

/**
 * Descarga y extracción verificada de artefactos empaquetados (tar.gz/zip).
 *
 * Los releases de Gitleaks publican un checksum del ARCHIVO COMPRIMIDO, no del
 * binario. El flujo seguro es:
 *   1. descargar el archivo a un temporal,
 *   2. verificar su SHA-256 contra el manifiesto,
 *   3. extraer sólo entonces el binario (`archiveEntry`),
 *   4. cachear el binario por versión+checksum del archivo.
 *
 * La descarga y la extracción se inyectan para pruebas deterministas sin red.
 *
 * (Requisitos 2.1–2.3, 2.6, 24.1–24.5.)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const https = require("https");

const { findArtifact, PLACEHOLDER_RE, SHA256_RE } = require("./tool-manifest.js");

const STATUS = Object.freeze({
  OK: "ok",
  UNAVAILABLE: "unavailable",
  INTEGRITY_FAILED: "integrity_failed",
  INCOMPATIBLE: "incompatible",
});

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function defaultCacheRoot() {
  return path.join(os.homedir(), ".cache", "kiritek", "tools");
}

/** Descarga HTTPS real a un archivo (sólo se usa fuera de pruebas). */
function httpsDownload(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.rmSync(destPath, { force: true });
          return httpsDownload(res.headers.location, destPath).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close();
        fs.rmSync(destPath, { force: true });
        reject(err);
      });
  });
}

/** Extrae el binario de un tar.gz o zip usando utilidades del sistema. */
function extractArchive(archivePath, entryName, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const isZip = archivePath.endsWith(".zip");
  let res;
  if (isZip) {
    res = spawnSync("unzip", ["-o", archivePath, entryName, "-d", destDir], { stdio: "ignore" });
  } else {
    res = spawnSync("tar", ["-xzf", archivePath, "-C", destDir, entryName], { stdio: "ignore" });
  }
  if (res.status !== 0) {
    throw new Error(`extracción falló (${isZip ? "unzip" : "tar"} status ${res.status})`);
  }
  const extracted = path.join(destDir, entryName);
  if (!fs.existsSync(extracted)) throw new Error(`entrada no encontrada en el archivo: ${entryName}`);
  return extracted;
}

/**
 * Resuelve un binario desde un artefacto empaquetado, verificando el checksum
 * del archivo antes de extraer.
 *
 * @param {object} opts
 * @param {object} opts.manifest
 * @param {string} opts.toolName
 * @param {string} opts.platform
 * @param {string} opts.arch
 * @param {string} [opts.cacheRoot]
 * @param {boolean} [opts.offline]
 * @param {(url, dest) => void} [opts.downloader]   Síncrono; inyectable.
 * @param {(archive, entry, destDir) => string} [opts.extractor]  Inyectable.
 * @returns {{ status, binaryPath?, version?, reason? }}
 */
function resolvePackagedTool(opts) {
  const { manifest, toolName, platform, arch } = opts;
  const cacheRoot = opts.cacheRoot || defaultCacheRoot();
  const offline = !!opts.offline;

  const artifact = findArtifact(manifest, toolName, platform, arch);
  if (!artifact) return { status: STATUS.INCOMPATIBLE, reason: `sin artefacto para ${platform}/${arch}` };
  if (PLACEHOLDER_RE.test(artifact.sha256) || !SHA256_RE.test(artifact.sha256)) {
    return { status: STATUS.INTEGRITY_FAILED, reason: "pin de checksum no verificado" };
  }

  const entry = artifact.archiveEntry || toolName;
  const binDir = path.join(cacheRoot, toolName, `${artifact.version}-${platform}-${arch}-${artifact.sha256.slice(0, 16)}`);
  const binPath = path.join(binDir, entry);

  if (fs.existsSync(binPath)) {
    return { status: STATUS.OK, binaryPath: binPath, version: artifact.version };
  }
  if (offline) return { status: STATUS.UNAVAILABLE, reason: "offline y sin cache" };

  const downloader = opts.downloader;
  if (typeof downloader !== "function") return { status: STATUS.UNAVAILABLE, reason: "sin downloader" };
  const extractor = opts.extractor || extractArchive;

  fs.mkdirSync(binDir, { recursive: true });
  const archiveTmp = path.join(binDir, `.archive.${crypto.randomBytes(6).toString("hex")}`);

  try {
    downloader(artifact.url, archiveTmp);
  } catch (err) {
    cleanup(archiveTmp);
    return { status: STATUS.UNAVAILABLE, reason: `descarga falló: ${err.message}` };
  }
  if (!fs.existsSync(archiveTmp)) return { status: STATUS.UNAVAILABLE, reason: "descarga sin archivo" };

  const actual = sha256File(archiveTmp);
  if (actual !== artifact.sha256) {
    cleanup(archiveTmp);
    return { status: STATUS.INTEGRITY_FAILED, reason: "checksum del archivo no coincide" };
  }

  let extracted;
  try {
    extracted = extractor(archiveTmp, entry, binDir);
  } catch (err) {
    cleanup(archiveTmp);
    return { status: STATUS.UNAVAILABLE, reason: `extracción falló: ${err.message}` };
  }
  cleanup(archiveTmp);

  try {
    fs.chmodSync(extracted, 0o700);
  } catch (_) {
    /* en algunos FS no aplica */
  }
  return { status: STATUS.OK, binaryPath: extracted, version: artifact.version };
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
  resolvePackagedTool,
  extractArchive,
  httpsDownload,
  sha256File,
  defaultCacheRoot,
};
