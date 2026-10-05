"use strict";

/**
 * Escaneo del contenido staged: une el alcance staged (git/staged-scope) con el
 * motor de políticas de archivos sensibles. Es la pieza que el hook pre-commit
 * invoca.
 *
 * Cache: resultados cacheados por `cacheKey` (hash del árbol staged + config).
 * Presupuesto: si el número de archivos excede el presupuesto, NO se omite el
 * control; se marca `overBudget` y se escanea igual (requisito 25.5: no omitir
 * control al excederlo). El presupuesto sirve para avisar, no para saltar.
 */

const { computeStagedScope } = require("../git/staged-scope.js");
const engine = require("../policy/engine.js");

const DEFAULT_BUDGET = 500;

/** Cache en memoria por proceso (clave → PolicyResult). */
const resultCache = new Map();

/**
 * Escanea el contenido staged del repo.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.mode            "warning" | "enforce"
 * @param {object[]} [opts.exceptions]
 * @param {number} [opts.budget]
 * @param {string} [opts.configHash]
 * @param {boolean} [opts.noCache]
 * @returns {{ result, files: object[], overBudget: boolean, cacheKey: string, cached: boolean }}
 */
function scanStaged(opts) {
  const { repoRoot, mode } = opts;
  if (typeof repoRoot !== "string") throw new TypeError("scanStaged.repoRoot requerido");
  const budget = opts.budget || DEFAULT_BUDGET;

  const scope = computeStagedScope(repoRoot, { configHash: opts.configHash });
  const cacheKey = `${scope.cacheKey}:${mode}`;

  if (!opts.noCache && resultCache.has(cacheKey)) {
    return { ...resultCache.get(cacheKey), cached: true };
  }

  const overBudget = scope.files.length > budget;

  const result = engine.evaluateFiles(
    {
      event: "pre-commit",
      mode,
      files: scope.files.map((f) => ({ path: f.path, content: f.content })),
    },
    { exceptions: opts.exceptions || [] }
  );

  const out = { result, files: scope.files, overBudget, cacheKey, cached: false };
  if (!opts.noCache) resultCache.set(cacheKey, { result, files: scope.files, overBudget, cacheKey });
  return out;
}

function clearCache() {
  resultCache.clear();
}

module.exports = { DEFAULT_BUDGET, scanStaged, clearCache };
