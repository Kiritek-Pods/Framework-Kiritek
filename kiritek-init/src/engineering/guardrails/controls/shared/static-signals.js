"use strict";

/**
 * Escaneo HEURÍSTICO de fuentes de una unidad por patrón (R8.1). Sólo
 * sugiere pedir evidencia: nunca bloquea. Límites de archivos y tamaño; no
 * sigue symlinks ni entra a dependencias o builds.
 */

const fs = require("node:fs");
const path = require("node:path");

const SKIP = new Set(["node_modules", ".git", "build", "dist", "out", "coverage", "Pods", ".dart_tool", ".gradle", "vendor", "target"]);
const DEFAULT_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".dart", ".kt", ".java", ".swift"];

/**
 * @param {string} repoRoot
 * @param {string} unitRoot
 * @param {{re: RegExp, signal: string, ext?: string[], maxFiles?, maxBytes?, maxSignals?}} opts
 */
function scanSources(repoRoot, unitRoot, { re, signal, ext = DEFAULT_EXT, maxFiles = 500, maxBytes = 256 * 1024, maxSignals = 20 }) {
  const exts = new Set(ext);
  const signals = [];
  let filesScanned = 0;
  let truncated = false;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (truncated || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(abs);
      } else if (e.isFile() && exts.has(path.extname(e.name))) {
        if (filesScanned >= maxFiles) {
          truncated = true;
          return;
        }
        filesScanned += 1;
        try {
          if (fs.statSync(abs).size <= maxBytes && re.test(fs.readFileSync(abs, "utf8")) && signals.length < maxSignals) {
            signals.push({ signal, path: path.relative(repoRoot, abs).split(path.sep).join("/") });
          }
        } catch (_) {
          /* ilegible */
        }
      }
    }
  };
  walk(path.join(repoRoot, unitRoot === "." ? "" : unitRoot));
  return { signals, filesScanned, truncated };
}

module.exports = { scanSources };
