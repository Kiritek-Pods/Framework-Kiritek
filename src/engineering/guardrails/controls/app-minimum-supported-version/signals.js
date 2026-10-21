"use strict";

/** Señales estáticas HEURÍSTICAS de lógica de versión mínima/forzado (T11; R8.1). */

const fs = require("node:fs");
const path = require("node:path");

const EXT = new Set([".dart", ".kt", ".java", ".swift", ".ts", ".tsx", ".js", ".jsx"]);
const SKIP = new Set(["node_modules", ".git", "build", "dist", "Pods", ".dart_tool", ".gradle"]);
const VERSION_GATE_RE = /(minimum_?version|min_?supported|force_?update|forceUpdate|in_app_update|AppUpdateManager|SKStoreProductViewController|itms-apps|market:\/\/details|remoteConfig|RemoteConfig)/;

function scanSignals(repoRoot, unitRoot, { maxFiles = 500, maxBytes = 256 * 1024 } = {}) {
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
      } else if (e.isFile() && EXT.has(path.extname(e.name))) {
        if (filesScanned >= maxFiles) {
          truncated = true;
          return;
        }
        filesScanned += 1;
        try {
          if (fs.statSync(abs).size <= maxBytes && VERSION_GATE_RE.test(fs.readFileSync(abs, "utf8")) && signals.length < 20) {
            signals.push({ signal: "VERSION_GATE_LOGIC", path: path.relative(repoRoot, abs).split(path.sep).join("/") });
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

module.exports = { scanSignals };
