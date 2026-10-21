"use strict";

/**
 * Verificación de plugins / control packs (T15B.1, T15B.4).
 *
 * Un plugin es un directorio VENDORIZADO en el repo
 * (`.kiritek/plugins/<namespace>__<name>/<version>/`) con
 * `kiritek-plugin.json`. La config lo fija por `{id, version, digest}`; aquí
 * se verifica, sin red ni ejecución:
 *  - schema del manifest, id/versión exactos iguales al pin;
 *  - digest = sha256(canónico {manifest sin digest, files}) igual al del
 *    manifest y al fijado; cada archivo con su checksum, sin archivos extra
 *    ni symlinks;
 *  - namespace: todo perfil/control/collector del plugin bajo su namespace;
 *  - compatibilidad de motor (rango semver sobre kiritek-init) y contrato;
 *  - supply chain: sin scripts de instalación, dependencias con versión
 *    exacta, sin `curl|sh`/`wget|sh` ni descargas ejecutables.
 */

const fs = require("node:fs");
const path = require("node:path");
const { validateAgainst } = require("../../../domain/schema-validator.js");
const { hashJson, sha256Of } = require("../canonical.js");
const { raise } = require("../errors.js");
const semver = require("../catalog/semver.js");

const MANIFEST = "kiritek-plugin.json";
const PLUGINS_DIR = ".kiritek/plugins";
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const PIPE_TO_SHELL_RE = /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|node|python3?|iex)\b/i;
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepublish"];
const EXACT_DEP_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Directorio relativo al repo de un plugin fijado. */
const pluginDirFor = (id, version) => `${PLUGINS_DIR}/${id.replace("/", "__")}/${version}`;

/** Digest de un plugin: manifest sin `digest` + mapa de checksums. */
function computePluginDigest(manifest) {
  const { digest, ...rest } = manifest; // eslint-disable-line no-unused-vars
  return hashJson({ manifest: rest });
}

function listFiles(absDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(absDir, abs).split(path.sep).join("/");
      if (e.isSymbolicLink()) raise("PLUGIN_FILE_TAMPERED", `el plugin contiene un symlink (${rel})`);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(rel);
      if (out.length > MAX_FILES) raise("PLUGIN_MANIFEST_INVALID", `el plugin excede ${MAX_FILES} archivos`);
    }
  };
  walk(absDir);
  return out.filter((f) => f !== MANIFEST);
}

function supplyChain(absDir, files) {
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(absDir, rel));
    const text = buf.toString("utf8");
    if (PIPE_TO_SHELL_RE.test(text)) raise("PLUGIN_MUTABLE_EXECUTION", `${rel} descarga y ejecuta código (curl|sh o equivalente)`, { remediation: "Vendorice y fije el código; no se permite ejecución mutable." });
    if (path.posix.basename(rel) === "package.json") {
      let pkg;
      try {
        pkg = JSON.parse(text);
      } catch (_) {
        raise("PLUGIN_MANIFEST_INVALID", `${rel} no es JSON válido`);
      }
      const scripts = Object.keys(pkg.scripts || {}).filter((s) => INSTALL_SCRIPTS.includes(s));
      if (scripts.length) raise("PLUGIN_MUTABLE_EXECUTION", `${rel} declara scripts de instalación (${scripts.join(", ")})`);
      for (const block of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [name, v] of Object.entries(pkg[block] || {})) {
          if (!EXACT_DEP_RE.test(String(v))) raise("PLUGIN_UNPINNED_DEPENDENCY", `${rel}: ${name}@${v} no está fijada a una versión exacta`, { remediation: "Use versiones exactas (sin ^, ~, *, latest, git ni URLs)." });
        }
      }
    }
  }
}

/**
 * @param {object} input { repoRoot, pin: {id, version, digest}, kiritekInitVersion }
 * @returns {{manifest, root: string, absRoot: string}}
 */
function verifyPlugin({ repoRoot, pin, kiritekInitVersion }) {
  const root = pluginDirFor(pin.id, pin.version);
  const absRoot = path.join(repoRoot, ...root.split("/"));
  const manifestPath = path.join(absRoot, MANIFEST);
  if (!fs.existsSync(manifestPath)) raise("PLUGIN_NOT_FOUND", `plugin ${pin.id}@${pin.version} no está vendorizado en ${root}`, { remediation: "Copie el plugin verificado al repo; no se descargan plugins en la evaluación." });
  if (fs.realpathSync(absRoot) !== path.resolve(fs.realpathSync(repoRoot), ...root.split("/"))) raise("PLUGIN_FILE_TAMPERED", `${root} resuelve fuera del repositorio`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_) {
    raise("PLUGIN_MANIFEST_INVALID", `${root}/${MANIFEST} no es JSON válido`);
  }
  if (!validateAgainst("engineering/plugin-manifest", manifest, { extended: true }).valid) raise("PLUGIN_MANIFEST_INVALID", `${pin.id}: manifest fuera de schema`);
  if (manifest.id !== pin.id || manifest.version !== pin.version) raise("PLUGIN_PIN_MISMATCH", `${root} contiene ${manifest.id}@${manifest.version}, fijado ${pin.id}@${pin.version}`);
  if (manifest.id.split("/")[0] !== manifest.namespace) raise("PLUGIN_NAMESPACE_INVALID", `${pin.id}: el id no pertenece al namespace ${manifest.namespace}`);

  const digest = computePluginDigest(manifest);
  if (digest !== manifest.digest || digest !== pin.digest) {
    raise("PLUGIN_DIGEST_MISMATCH", `${pin.id}@${pin.version}: digest ${digest.slice(0, 19)}… no coincide con el ${digest !== manifest.digest ? "del manifest" : "fijado en la config"}`, { remediation: "Verifique el origen del plugin; un cambio de contenido exige nueva versión y nuevo pin." });
  }
  const onDisk = listFiles(absRoot);
  const declared = Object.keys(manifest.files).sort();
  const extra = onDisk.filter((f) => !manifest.files[f]);
  const missing = declared.filter((f) => !onDisk.includes(f));
  if (extra.length || missing.length) raise("PLUGIN_FILE_TAMPERED", `${pin.id}: archivos ${extra.length ? `no declarados (${extra.join(", ")})` : `faltantes (${missing.join(", ")})`}`);
  for (const rel of declared) {
    const abs = path.join(absRoot, ...rel.split("/"));
    if (fs.statSync(abs).size > MAX_FILE_BYTES) raise("PLUGIN_MANIFEST_INVALID", `${rel} excede el tamaño máximo`);
    if (sha256Of(fs.readFileSync(abs)) !== manifest.files[rel]) raise("PLUGIN_FILE_TAMPERED", `${pin.id}: ${rel} no coincide con su checksum`);
  }
  if (!manifest.files[manifest.entry]) raise("PLUGIN_MANIFEST_INVALID", `${pin.id}: entry ${manifest.entry} no está entre los archivos verificados`);
  if (!semver.satisfies(kiritekInitVersion, manifest.engine.kiritekInit)) {
    raise("PLUGIN_INCOMPATIBLE", `${pin.id} requiere kiritek-init ${manifest.engine.kiritekInit}; instalado ${kiritekInitVersion}`);
  }
  supplyChain(absRoot, declared);
  return { manifest, root, absRoot };
}

module.exports = { MANIFEST, PLUGINS_DIR, pluginDirFor, computePluginDigest, verifyPlugin, PIPE_TO_SHELL_RE };
