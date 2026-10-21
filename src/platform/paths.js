"use strict";

/**
 * Utilidades de rutas y resolución de raíz Git multiplataforma.
 *
 * Objetivos (Tarea 36.2–36.4, requisitos 4.8, 23.2–23.3, 23.5–23.6, 26.2):
 *  - Resolver la raíz Git y los workspaces SIN escanear fuera del repo.
 *  - Soportar monorepos/subdirectorios: desde cualquier subdirectorio se
 *    resuelve la raíz del worktree, no el `cwd`.
 *  - Detectar worktrees enlazados: un worktree enlazado tiene un `.git` que es
 *    un ARCHIVO con un puntero `gitdir:`, no un directorio.
 *  - Manejar rutas con espacios/Unicode, separadores nativos y CRLF/LF.
 *  - Impedir escapes por symlink: una ruta cuyo realpath cae fuera de la raíz
 *    del repo se RECHAZA (política no-follow para contención).
 *  - Declarar capacidades POSIX no soportadas en lugar de asumirlas en silencio.
 *
 * Toda invocación a Git usa `spawnSync` con argumentos separados; nunca se
 * interpola una ruta no confiable en un shell.
 *
 * Decisión follow/no-follow documentada:
 *  - Para CONTENCIÓN (¿esta ruta pertenece al repo?) se resuelve el realpath
 *    (se "siguen" los symlinks) y se exige que el destino real quede dentro de
 *    la raíz real del repo. Un symlink que apunta fuera se trata como ESCAPE y
 *    se rechaza. Es decir: seguimos el enlace sólo para verificar el destino,
 *    nunca para operar fuera del árbol.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

/** Capacidades que dependen de un sistema POSIX. */
const POSIX_CAPABILITIES = Object.freeze([
  "symlink", // creación/uso de enlaces simbólicos
  "exec-bit", // bit ejecutable en permisos de archivo
  "file-mode", // modos de archivo tipo chmod (rwx)
]);

/**
 * ¿El runtime actual es POSIX (macOS/Linux) o Windows?
 * No se asume: se decide por `process.platform`.
 */
function isWindows(platform) {
  return (platform || process.platform) === "win32";
}

/**
 * Reporta qué capacidades POSIX están disponibles en esta plataforma, con una
 * razón honesta cuando no lo están. No simula soporte.
 *
 * @param {string} [platform=process.platform]
 * @returns {Array<{ capability: string, available: boolean, reason: string }>}
 */
function posixCapabilities(platform) {
  const win = isWindows(platform);
  return POSIX_CAPABILITIES.map((capability) => {
    if (!win) {
      return { capability, available: true, reason: "plataforma POSIX" };
    }
    switch (capability) {
      case "symlink":
        return {
          capability,
          available: false,
          reason:
            "Windows nativo requiere privilegio/Developer Mode para symlinks; " +
            "Kiritek no asume su disponibilidad y usa archivos regulares.",
        };
      case "exec-bit":
        return {
          capability,
          available: false,
          reason:
            "Windows no usa el bit ejecutable; los hooks se invocan vía shim " +
            "Node/PowerShell en lugar de depender de permisos de ejecución.",
        };
      case "file-mode":
        return {
          capability,
          available: false,
          reason:
            "Windows no implementa modos rwx estilo POSIX; se evita chmod y se " +
            "declara la alternativa soportada.",
        };
      default:
        return { capability, available: false, reason: "no soportado en Windows" };
    }
  });
}

function gitRaw(cwd, args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (res.error) return { ok: false, status: 1, stdout: "", stderr: String(res.error.message) };
  return { ok: res.status === 0, status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/**
 * Normaliza separadores de ruta a `/` para comparaciones/fingerprints estables
 * entre plataformas. No altera el significado de la ruta.
 */
function toPosixSeparators(p) {
  return String(p).split(path.sep).join("/");
}

/**
 * Normaliza finales de línea a LF para análisis de contenido. Devuelve el texto
 * sin CR; informa si el original tenía CRLF.
 *
 * @param {string} text
 * @returns {{ normalized: string, hadCRLF: boolean }}
 */
function normalizeLineEndings(text) {
  const s = String(text == null ? "" : text);
  const hadCRLF = /\r\n/.test(s);
  return { normalized: s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), hadCRLF };
}

/**
 * Resuelve la raíz del worktree Git desde cualquier subdirectorio, sin asumir
 * el `cwd` ni escanear fuera del repo. Detecta worktrees enlazados.
 *
 * @param {string} startDir  Directorio desde el que resolver (p. ej. subdir de un monorepo).
 * @returns {{
 *   ok: boolean,
 *   repoRoot: string|null,     // raíz del worktree (top-level)
 *   gitDir: string|null,       // directorio .git real (puede estar fuera del worktree en enlazados)
 *   commonDir: string|null,    // git common dir (compartido entre worktrees)
 *   isLinkedWorktree: boolean, // true si el .git es un archivo con puntero gitdir:
 *   insideWorkTree: boolean,
 *   reason: string
 * }}
 */
function resolveGitRoot(startDir) {
  const start = path.resolve(startDir || process.cwd());

  const inside = gitRaw(start, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      ok: false,
      repoRoot: null,
      gitDir: null,
      commonDir: null,
      isLinkedWorktree: false,
      insideWorkTree: false,
      reason: inside.stderr.trim() || "no es un árbol de trabajo Git",
    };
  }

  const top = gitRaw(start, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) {
    return {
      ok: false,
      repoRoot: null,
      gitDir: null,
      commonDir: null,
      isLinkedWorktree: false,
      insideWorkTree: true,
      reason: "no se pudo resolver el top-level del worktree",
    };
  }
  const repoRoot = path.resolve(top.stdout.trim());

  // git dir del worktree actual (absoluto) y common dir compartido.
  const gitDirRes = gitRaw(start, ["rev-parse", "--absolute-git-dir"]);
  const gitDir = gitDirRes.ok && gitDirRes.stdout.trim() ? path.resolve(gitDirRes.stdout.trim()) : null;

  const commonRes = gitRaw(start, ["rev-parse", "--git-common-dir"]);
  let commonDir = null;
  if (commonRes.ok && commonRes.stdout.trim()) {
    const c = commonRes.stdout.trim();
    commonDir = path.isAbsolute(c) ? c : path.resolve(repoRoot, c);
  }

  // Worktree enlazado: el `.git` en la raíz es un ARCHIVO con `gitdir:`.
  const isLinkedWorktree = detectLinkedWorktree(repoRoot).linked;

  return {
    ok: true,
    repoRoot,
    gitDir,
    commonDir,
    isLinkedWorktree,
    insideWorkTree: true,
    reason: "ok",
  };
}

/**
 * Detecta si la raíz dada corresponde a un worktree enlazado inspeccionando el
 * `.git`: en un worktree principal `.git` es un directorio; en uno enlazado es
 * un archivo de texto `gitdir: <ruta>`.
 *
 * @param {string} repoRoot
 * @returns {{ linked: boolean, gitdirPointer: string|null, reason: string }}
 */
function detectLinkedWorktree(repoRoot) {
  const dotGit = path.join(repoRoot, ".git");
  let stat;
  try {
    stat = fs.lstatSync(dotGit);
  } catch (_) {
    return { linked: false, gitdirPointer: null, reason: "sin .git en la raíz" };
  }
  if (stat.isDirectory()) {
    return { linked: false, gitdirPointer: null, reason: ".git es directorio (worktree principal)" };
  }
  if (stat.isFile()) {
    let content = "";
    try {
      content = fs.readFileSync(dotGit, "utf8");
    } catch (_) {
      return { linked: false, gitdirPointer: null, reason: "no se pudo leer .git" };
    }
    const m = content.match(/^gitdir:\s*(.+)\s*$/m);
    if (m) {
      const pointer = m[1].trim();
      const resolved = path.isAbsolute(pointer) ? pointer : path.resolve(repoRoot, pointer);
      return { linked: true, gitdirPointer: resolved, reason: "worktree enlazado (.git es archivo)" };
    }
    return { linked: false, gitdirPointer: null, reason: ".git es archivo sin puntero gitdir:" };
  }
  return { linked: false, gitdirPointer: null, reason: ".git no es ni archivo ni directorio" };
}

/**
 * Resuelve, sin escanear fuera del repo, la raíz del worktree que contiene un
 * subdirectorio concreto (uso típico en monorepos). Equivale a resolveGitRoot
 * pero devuelve sólo la raíz o null.
 */
function workspaceRootFor(subdir) {
  const r = resolveGitRoot(subdir);
  return r.ok ? r.repoRoot : null;
}

/**
 * Normaliza una ruta a forma relativa POSIX respecto a `repoRoot` y verifica
 * contención léxica (sin tocar el disco). Lanza si escapa.
 *
 * Útil para rutas que aún no existen (no se puede resolver realpath).
 */
function containRelative(repoRoot, target) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("repoRoot debe ser un string no vacío");
  }
  if (typeof target !== "string" || target.trim() === "") {
    throw new TypeError("target debe ser un string no vacío");
  }
  const absRoot = path.resolve(repoRoot);
  const absTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(absRoot, target);
  const rel = path.relative(absRoot, absTarget);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`ruta fuera del repositorio: ${target}`);
  }
  return toPosixSeparators(rel);
}

/**
 * Verifica contención REAL siguiendo symlinks: resuelve el realpath del target
 * (y de sus ancestros existentes) y exige que caiga dentro de la raíz real del
 * repo. Un symlink que escapa se RECHAZA.
 *
 * Política follow/no-follow: se SIGUE el enlace sólo para validar el destino;
 * si el destino real queda fuera del repo, es un escape y se bloquea. Nunca se
 * opera fuera del árbol real del repositorio.
 *
 * @param {string} repoRoot
 * @param {string} target  Ruta (absoluta o relativa) a validar.
 * @returns {{ contained: boolean, realPath: string|null, escape: boolean, reason: string, relative: string|null }}
 */
function containReal(repoRoot, target) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("repoRoot debe ser un string no vacío");
  }
  if (typeof target !== "string" || target.trim() === "") {
    throw new TypeError("target debe ser un string no vacío");
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(path.resolve(repoRoot));
  } catch (_) {
    // Si la raíz no se puede resolver, caemos a resolución léxica de la raíz.
    realRoot = path.resolve(repoRoot);
  }

  const absTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(realRoot, target);

  // Resolver el realpath del ancestro existente más profundo (el target puede
  // no existir todavía). Esto detecta un symlink intermedio que escapa.
  const realTarget = realpathOfExistingAncestor(absTarget);

  const rel = path.relative(realRoot, realTarget);
  const escape = rel === "" ? false : rel.startsWith("..") || path.isAbsolute(rel);

  if (escape) {
    return {
      contained: false,
      realPath: realTarget,
      escape: true,
      reason: `la ruta resuelve fuera del repo vía symlink/traversal: ${toPosixSeparators(rel)}`,
      relative: null,
    };
  }
  return {
    contained: true,
    realPath: realTarget,
    escape: false,
    reason: "contenida en el repo",
    relative: rel === "" ? "." : toPosixSeparators(rel),
  };
}

/**
 * Resuelve el realpath del ancestro existente más profundo de `absTarget`,
 * reponiendo luego los segmentos inexistentes. Así un symlink intermedio queda
 * resuelto aunque el hoja no exista todavía.
 */
function realpathOfExistingAncestor(absTarget) {
  let current = absTarget;
  const trailing = [];
  // Subir hasta encontrar un ancestro existente.
  // Límite de seguridad: la profundidad de la ruta.
  const maxDepth = current.split(path.sep).length + 1;
  for (let i = 0; i < maxDepth; i++) {
    try {
      const real = fs.realpathSync(current);
      // Reponer los segmentos que faltaban, resueltos léxicamente.
      return trailing.length ? path.resolve(real, ...trailing.reverse()) : real;
    } catch (_) {
      const parent = path.dirname(current);
      if (parent === current) break; // llegamos a la raíz del FS
      trailing.push(path.basename(current));
      current = parent;
    }
  }
  // Nada existe: devolver la resolución léxica.
  return absTarget;
}

/**
 * ¿El archivo tiene bit ejecutable? En Windows el concepto no aplica: se
 * devuelve `applicable:false` con razón, en vez de fingir.
 *
 * @param {string} filePath
 * @param {string} [platform=process.platform]
 */
function hasExecBit(filePath, platform) {
  if (isWindows(platform)) {
    return { applicable: false, executable: null, reason: "bit ejecutable no aplica en Windows" };
  }
  try {
    const st = fs.statSync(filePath);
    const executable = (st.mode & 0o111) !== 0;
    return { applicable: true, executable, reason: executable ? "tiene bit ejecutable" : "sin bit ejecutable" };
  } catch (err) {
    return { applicable: true, executable: null, reason: `no se pudo leer el modo: ${err.message}` };
  }
}

/**
 * Crea un directorio temporal con prefijo Kiritek (para fixtures/instalación).
 */
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || "kiritek-"));
}

module.exports = {
  POSIX_CAPABILITIES,
  isWindows,
  posixCapabilities,
  toPosixSeparators,
  normalizeLineEndings,
  resolveGitRoot,
  detectLinkedWorktree,
  workspaceRootFor,
  containRelative,
  containReal,
  realpathOfExistingAncestor,
  hasExecBit,
  tmpDir,
};
