"use strict";

/**
 * Resolución reproducible del catálogo (R4.3, R4.6; T02.2).
 *
 * - Versión exacta obligatoria: `latest`, rangos o vacío fallan.
 * - Sólo fuentes locales verificadas (builtin + cache). Ausencia ⇒ error
 *   accionable; nunca fallback a otra versión.
 * - Una ejecución usa una única snapshot inmutable (`createCatalogSession`).
 * - Incompatibilidad de motor/plataforma o digest fijado distinto fallan
 *   antes de evaluar cualquier control.
 */

const path = require("node:path");
const { deepFreeze } = require("../contracts/common.js");
const { catalogRefOf } = require("../contracts/catalog.js");
const { raise } = require("../errors.js");
const semver = require("./semver.js");
const { BUILTIN_ROOT, versionDir } = require("./registry.js");
const { loadCatalogDir } = require("./load.js");
const { readFromCache } = require("./cache.js");
const { assertCatalogConformance } = require("./conformance.js");
const fs = require("node:fs");

const PACKAGE_VERSION = require("../../../../package.json").version;

function assertExactVersion(version) {
  if (typeof version !== "string" || version.trim() === "") {
    raise("CATALOG_VERSION_REQUIRED", "se requiere una versión exacta de catálogo", {
      remediation: 'Declare pack.catalog en kiritek-engineering.config.json, p. ej. "1.0.0".',
    });
  }
  if (!semver.isExact(version)) {
    raise("CATALOG_VERSION_NOT_EXACT", `versión de catálogo no exacta: ${JSON.stringify(version)} (no se admiten 'latest' ni rangos)`, {
      remediation: "Fije una versión semver exacta.",
    });
  }
}

function assertCompatible(catalog, runtime) {
  const problems = [];
  if (!semver.satisfies(runtime.nodeVersion, catalog.compatibility.node)) {
    problems.push(`Node ${runtime.nodeVersion} no satisface ${catalog.compatibility.node}`);
  }
  if (!semver.satisfies(runtime.kiritekInitVersion, catalog.compatibility.kiritekInit)) {
    problems.push(`kiritek-init ${runtime.kiritekInitVersion} no satisface ${catalog.compatibility.kiritekInit}`);
  }
  if (!catalog.compatibility.platforms.includes(runtime.platform)) {
    problems.push(`plataforma ${runtime.platform} no soportada (${catalog.compatibility.platforms.join(", ")})`);
  }
  if (problems.length) {
    raise("CATALOG_INCOMPATIBLE", `catálogo ${catalog.version} incompatible: ${problems.join("; ")}`, {
      remediation: "Use una versión de catálogo compatible con este entorno; no se resuelve otra automáticamente.",
    });
  }
}

/**
 * @param {object} options
 * @param {string} options.version              Versión exacta.
 * @param {string} [options.expectedDigest]     Digest fijado (config).
 * @param {string[]} [options.roots]            Raíces builtin (default: la del paquete).
 * @param {string} [options.cacheRoot]          Cache verificada.
 * @param {object} [options.runtime]            { nodeVersion, kiritekInitVersion, platform }.
 * @param {Record<string,string>} [options.trustedKeys]
 * @param {boolean} [options.requireSignature]
 * @param {string[]} [options.approvedConformanceSuites]
 * @param {{id, version, digest}[]} [options.plugins]  Plugins fijados (T15B).
 * @param {string} [options.repoRoot]                  Donde están vendorizados.
 */
function resolveCatalog(options = {}) {
  assertExactVersion(options.version);
  const version = options.version;
  const runtime = {
    nodeVersion: process.versions.node,
    kiritekInitVersion: PACKAGE_VERSION,
    platform: process.platform,
    ...(options.runtime || {}),
  };
  const verifyOpts = { trustedKeys: options.trustedKeys, requireSignature: options.requireSignature, onDiagnostic: (d) => diagnostics.push(d) };
  const diagnostics = [];
  const candidates = [];

  for (const root of options.roots || [BUILTIN_ROOT]) {
    const dir = versionDir(root, version);
    if (fs.existsSync(path.join(dir, "catalog.json"))) candidates.push({ kind: "builtin", loaded: loadCatalogDir(dir, verifyOpts) });
  }
  if (options.cacheRoot) {
    const cached = readFromCache(options.cacheRoot, version, verifyOpts);
    if (cached) candidates.push({ kind: "cache", loaded: cached });
  }

  if (candidates.length === 0) {
    raise("CATALOG_NOT_INSTALLED", `catálogo engineering/guardrails ${version} no está instalado localmente`, {
      remediation: options.offline
        ? "Modo offline: instale el catálogo verificado en la cache antes de evaluar."
        : "Instale/actualice el catálogo (kiritek-init guardrails catalog) o fije una versión instalada.",
    });
  }
  const digests = new Set(candidates.map((c) => c.loaded.catalog.digest));
  if (digests.size > 1) {
    raise("CATALOG_CONFLICT", `hay copias de ${version} con distinto digest (${candidates.map((c) => c.kind).join(", ")})`, {
      remediation: "Elimine la copia no verificada; las versiones publicadas son inmutables.",
    });
  }
  const chosen = candidates[0];
  const { catalog } = chosen.loaded;
  if (catalog.version !== version) {
    raise("CATALOG_VERSION_MISMATCH", `el directorio ${version} contiene el catálogo ${catalog.version}`);
  }
  if (options.expectedDigest && options.expectedDigest !== catalog.digest) {
    raise("CATALOG_DIGEST_PINNED_MISMATCH", `el digest de ${version} no coincide con el fijado en la configuración`, {
      remediation: "Verifique el origen del catálogo o actualice el digest fijado tras revisar el diff.",
    });
  }
  assertCompatible(catalog, runtime);
  const conformance = assertCatalogConformance(chosen.loaded, { approvedConformanceSuites: options.approvedConformanceSuites });

  // Plugins fijados: se verifican y fusionan con digest compuesto (T15B).
  let effective = catalog;
  let parameterSchemas = JSON.parse(JSON.stringify(chosen.loaded.parameterSchemas));
  let plugins = [];
  if (options.plugins && options.plugins.length) {
    const { loadPluginPacks, compositeDigest } = require("../plugins/loader.js");
    const loadedPlugins = loadPluginPacks({ repoRoot: options.repoRoot, pins: options.plugins, catalog, approvedConformanceSuites: options.approvedConformanceSuites, kiritekInitVersion: runtime.kiritekInitVersion });
    plugins = loadedPlugins.plugins;
    effective = { ...catalog, profiles: [...catalog.profiles, ...loadedPlugins.profiles], controls: [...catalog.controls, ...loadedPlugins.controls], digest: compositeDigest(catalog.digest, plugins) };
    parameterSchemas = { ...parameterSchemas, ...JSON.parse(JSON.stringify(loadedPlugins.parameterSchemas)) };
    diagnostics.push(...loadedPlugins.diagnostics);
  }

  return deepFreeze({
    ref: catalogRefOf(effective),
    catalog: effective,
    files: { ...chosen.loaded.files },
    parameterSchemas,
    source: chosen.kind,
    signature: chosen.loaded.signature,
    conformance,
    plugins,
    ...(plugins.length ? { baseDigest: catalog.digest } : {}),
    diagnostics,
  });
}

/**
 * Sesión de ejecución: resuelve el catálogo una sola vez y reutiliza la misma
 * snapshot. Pedir otra versión/digest en la misma ejecución es un error: no
 * se mezclan catálogos (R4.6).
 */
function createCatalogSession(baseOptions = {}) {
  let snapshot = null;
  return {
    resolve(version, extra = {}) {
      if (snapshot) {
        const pinsOf = (list) => JSON.stringify((list || []).map((p) => `${p.id}@${p.version}#${p.digest}`).sort());
        const base = snapshot.baseDigest || snapshot.ref.digest;
        if (version !== snapshot.ref.version || (extra.expectedDigest && extra.expectedDigest !== base) || (extra.plugins !== undefined && pinsOf(extra.plugins) !== pinsOf(snapshot.plugins))) {
          raise("CATALOG_MIXED_VERSIONS", `la ejecución ya fijó ${snapshot.ref.version}; no se puede mezclar con ${version}`);
        }
        return snapshot;
      }
      snapshot = resolveCatalog({ ...baseOptions, ...extra, version });
      return snapshot;
    },
    get snapshot() {
      return snapshot;
    },
  };
}

module.exports = { resolveCatalog, createCatalogSession, assertExactVersion };
