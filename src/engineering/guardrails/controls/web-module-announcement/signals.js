"use strict";

/**
 * Señales HEURÍSTICAS de "posible módulo nuevo" por ruta del cambio
 * (T12.1; R11.10). Sólo sugieren confirmar el lanzamiento: nunca bloquean.
 */

const MODULE_ENTRY_RE = /(?:^|\/)(?:modules|features|pages|routes|app)\/[^/]+\/(?:index|page|route|layout|module)\.[cm]?[jt]sx?$/;

function scanSignals(paths) {
  const signals = [];
  for (const p of [...paths].sort()) {
    if (MODULE_ENTRY_RE.test(p) && signals.length < 20) signals.push({ signal: "POSSIBLE_NEW_MODULE", path: p });
  }
  return { signals, pathsScanned: paths.length };
}

module.exports = { scanSignals };
