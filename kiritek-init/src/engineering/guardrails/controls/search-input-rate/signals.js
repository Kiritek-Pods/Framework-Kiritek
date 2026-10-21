"use strict";

/**
 * Señales estáticas (HEURÍSTICAS) de búsqueda interactiva sin contrato
 * (T10.5; R9.7). Sólo sugieren: nunca alimentan findings bloqueantes. No se
 * copia contenido de archivos; sólo rutas relativas y códigos de señal.
 */

const fs = require("node:fs");
const path = require("node:path");

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".dart", ".kt", ".swift"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", "Pods", ".dart_tool"]);
const HANDLER_RE = /(onChange|onInput|oninput|onChanged|onTextChanged|addEventListener\(\s*['"](?:input|keyup)['"]|v-model|bind:value)/;
const NETWORK_RE = /(fetch\(|axios|XMLHttpRequest|http\.(?:get|post)|HttpClient|useQuery|graphql|URLSession|Retrofit|Dio\()/;
const SEARCH_RE = /search|buscar|autocomplete|typeahead/i;
const CADENCE_RE = /(debounce|throttle|switchMap|distinctUntilChanged|sampleTime|auditTime)/;

function scanSignals(repoRoot, unitRoot, limits = {}) {
  const maxFiles = limits.maxFiles || 500;
  const maxBytes = limits.maxBytes || 256 * 1024;
  const base = path.join(repoRoot, unitRoot === "." ? "" : unitRoot);
  const signals = [];
  let filesScanned = 0;
  let truncated = false;
  let cadenceHintDetected = false;
  const walk = (dir) => {
    if (truncated) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(abs);
        continue;
      }
      if (!e.isFile() || !EXTENSIONS.has(path.extname(e.name))) continue;
      if (filesScanned >= maxFiles) {
        truncated = true;
        return;
      }
      filesScanned += 1;
      let text;
      try {
        if (fs.statSync(abs).size > maxBytes) continue;
        text = fs.readFileSync(abs, "utf8");
      } catch (_) {
        continue;
      }
      if (CADENCE_RE.test(text)) cadenceHintDetected = true;
      if (HANDLER_RE.test(text) && NETWORK_RE.test(text) && SEARCH_RE.test(text) && signals.length < 20) {
        signals.push({ signal: "INPUT_HANDLER_WITH_NETWORK", path: path.relative(repoRoot, abs).split(path.sep).join("/") });
      }
    }
  };
  walk(base);
  return { signals, cadenceHintDetected, filesScanned, truncated };
}

module.exports = { scanSignals };
