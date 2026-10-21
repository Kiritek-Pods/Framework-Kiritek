"use strict";

/**
 * Inventario/SBOM mínimo de las herramientas distribuidas por el core.
 *
 * Sólo incluye componentes inspeccionados (los del manifiesto). No afirma
 * cobertura de dependencias transitivas no inspeccionadas (requisito 24.7).
 */

function buildToolInventory(manifest, deps = {}) {
  const now = deps.now ? deps.now() : new Date().toISOString();
  const components = [];
  for (const tool of manifest.tools || []) {
    for (const art of tool.artifacts || []) {
      components.push({
        name: tool.name,
        version: tool.version,
        platform: art.platform,
        arch: art.arch,
        provenance: tool.provenance || null,
        sha256: art.sha256,
      });
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: now,
    scope: "distributed-tools-only",
    note: "No cubre dependencias transitivas no inspeccionadas.",
    components,
  };
}

module.exports = { buildToolInventory };
