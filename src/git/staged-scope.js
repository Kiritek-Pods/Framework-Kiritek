"use strict";

/**
 * Cálculo del alcance staged exacto para el hook pre-commit.
 *
 * El escaneo pre-commit debe mirar SÓLO el contenido que entraría al commit
 * (el índice), nunca el contenido unstaged del árbol de trabajo. Para eso:
 *  - se listan los cambios staged con `git diff --cached -z --name-status`,
 *  - se lee el contenido de cada ruta desde el índice con `git show :path`,
 *  - los borrados y binarios se tratan aparte.
 *
 * Todo se invoca con `spawnSync` y argumentos separados; nunca por shell, de
 * modo que rutas con espacios o caracteres especiales no rompen ni inyectan.
 *
 * (Requisitos 3.1, 4.8, 23.3, 23.5–23.6, G.3.)
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");

/** Estados de archivo staged relevantes. */
const CHANGE = Object.freeze({
  ADDED: "A",
  MODIFIED: "M",
  RENAMED: "R",
  COPIED: "C",
  DELETED: "D",
  TYPE_CHANGED: "T",
});

function git(repoRoot, args, { encoding = "utf8", maxBuffer = 50 * 1024 * 1024 } = {}) {
  const res = spawnSync("git", ["-C", repoRoot, ...args], { encoding, maxBuffer });
  if (res.error) throw res.error;
  return res;
}

/**
 * Parsea la salida -z de `git diff --cached --name-status`.
 * Formato: STATUS\0path\0 (y para R/C: STATUS\0old\0new\0).
 */
function parseNameStatusZ(buf) {
  const parts = buf.split("\0").filter((s) => s.length > 0);
  const entries = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      entries.push({ change: code, path: newPath, oldPath });
      i += 3;
    } else {
      const p = parts[i + 1];
      entries.push({ change: code, path: p });
      i += 2;
    }
  }
  return entries;
}

/**
 * Lee el contenido de una ruta desde el índice (contenido staged).
 * @returns {{ content: string|null, binary: boolean }}
 */
function readStagedContent(repoRoot, relPath) {
  const res = git(repoRoot, ["show", `:${relPath}`], { encoding: "buffer" });
  if (res.status !== 0 || !res.stdout) return { content: null, binary: false };
  const buf = res.stdout;
  // Heurística de binario: presencia de NUL en los primeros 8KB.
  const slice = buf.subarray(0, 8192);
  const binary = slice.includes(0);
  return { content: binary ? null : buf.toString("utf8"), binary };
}

/**
 * Hash del índice staged (árbol) + config, para cachear resultados sin
 * reutilizar nada obsoleto.
 */
function stagedCacheKey(repoRoot, configHash) {
  const res = git(repoRoot, ["write-tree"]);
  const tree = res.status === 0 ? res.stdout.trim() : "no-tree";
  return crypto.createHash("sha256").update(`${tree}:${configHash || "none"}`).digest("hex").slice(0, 32);
}

/**
 * Calcula el alcance staged: lista de archivos con su contenido del índice.
 *
 * @param {string} repoRoot
 * @param {object} [opts] { includeContent=true }
 * @returns {{ files: Array<{path, change, oldPath?, content?, binary}>, cacheKey: string }}
 */
function computeStagedScope(repoRoot, opts = {}) {
  const includeContent = opts.includeContent !== false;
  const res = git(repoRoot, ["diff", "--cached", "-z", "--name-status"], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git diff --cached falló (status ${res.status})`);
  }
  const entries = parseNameStatusZ(res.stdout || "");

  const files = [];
  for (const e of entries) {
    // Los borrados no aportan contenido nuevo que escanear.
    if (e.change === CHANGE.DELETED) {
      files.push({ path: e.path, change: e.change, binary: false });
      continue;
    }
    const file = { path: e.path, change: e.change };
    if (e.oldPath) file.oldPath = e.oldPath;
    if (includeContent) {
      const { content, binary } = readStagedContent(repoRoot, e.path);
      file.binary = binary;
      if (content !== null) file.content = content;
    } else {
      file.binary = false;
    }
    files.push(file);
  }

  return { files, cacheKey: stagedCacheKey(repoRoot, opts.configHash) };
}

module.exports = {
  CHANGE,
  parseNameStatusZ,
  readStagedContent,
  stagedCacheKey,
  computeStagedScope,
};
