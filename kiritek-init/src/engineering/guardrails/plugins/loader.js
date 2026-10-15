"use strict";

/**
 * Carga de plugins fijados en la config (T15B). Determinista: los pins se
 * procesan ordenados; cualquier fallo de verificación, colisión de ids o
 * namespace incompatible rechaza la resolución completa (R23.2) — un plugin
 * alterado es un incidente de supply chain, no un warning.
 *
 * El resultado se fusiona en la snapshot del catálogo: perfiles, controles y
 * schemas de parámetros, con un digest COMPUESTO (catálogo + plugins) para
 * que evidencia, cache y config queden ligados a la extensión exacta.
 */

const { hashJson } = require("../canonical.js");
const { raise } = require("../errors.js");
const { verifyPlugin } = require("./manifest.js");
const { conformPlugin } = require("./conformance.js");

/**
 * @param {object} input { repoRoot, pins, catalog, approvedConformanceSuites, kiritekInitVersion }
 * @returns {{plugins: object[], profiles: object[], controls: object[], parameterSchemas: object, diagnostics: object[]}}
 */
function loadPluginPacks({ repoRoot, pins, catalog, approvedConformanceSuites, kiritekInitVersion }) {
  if (!repoRoot) raise("PLUGIN_REPO_REQUIRED", "los plugins se resuelven desde el repositorio (repoRoot requerido)");
  const sorted = [...pins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const owners = new Map([...catalog.profiles.map((p) => [`profile:${p.id}`, "builtin"]), ...catalog.controls.map((c) => [`control:${c.id}`, "builtin"])]);
  const namespaces = new Map();
  const out = { plugins: [], profiles: [], controls: [], parameterSchemas: {}, diagnostics: [] };
  for (const pin of sorted) {
    if (out.plugins.some((p) => p.id === pin.id)) raise("PLUGIN_CONFLICT", `plugin ${pin.id} fijado más de una vez`);
    const { manifest, root, absRoot } = verifyPlugin({ repoRoot, pin, kiritekInitVersion });
    if (namespaces.has(manifest.namespace)) raise("PLUGIN_CONFLICT", `namespace ${manifest.namespace} reclamado por ${namespaces.get(manifest.namespace)} y ${manifest.id}`);
    namespaces.set(manifest.namespace, manifest.id);
    const c = conformPlugin({ manifest, absRoot, approvedConformanceSuites });
    for (const [kind, list] of [["profile", c.profiles], ["control", c.controls]]) {
      for (const item of list) {
        const key = `${kind}:${item.id}`;
        if (owners.has(key)) raise("PLUGIN_CONFLICT", `${kind} ${item.id} ya definido por ${owners.get(key)}; ${manifest.id} no puede redefinirlo`);
        owners.set(key, manifest.id);
      }
    }
    out.plugins.push({
      id: manifest.id,
      version: manifest.version,
      digest: manifest.digest,
      namespace: manifest.namespace,
      root,
      entry: manifest.entry,
      controls: c.controls.map((x) => x.id),
      dataRequests: (manifest.dataRequests || []).map((r) => ({ ...r })),
    });
    out.profiles.push(...c.profiles);
    out.controls.push(...c.controls);
    Object.assign(out.parameterSchemas, c.parameterSchemas);
    out.diagnostics.push(...c.diagnostics);
  }
  return out;
}

/** Digest compuesto catálogo + plugins (orden estable). */
function compositeDigest(catalogDigest, plugins) {
  return hashJson({ catalog: catalogDigest, plugins: plugins.map((p) => `${p.id}@${p.version}#${p.digest}`).sort() });
}

module.exports = { loadPluginPacks, compositeDigest };
