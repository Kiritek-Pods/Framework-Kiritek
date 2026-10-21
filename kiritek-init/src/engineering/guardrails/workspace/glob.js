"use strict";

/**
 * Globs de ownership sin dependencias (rutas POSIX relativas al repo).
 *
 * - `**` cruza cualquier número de segmentos (incluido cero).
 * - `*` y `?` no cruzan `/`; `[abc]` y `{a,b}` como en shells.
 * - Un patrón sin comodines significa "esa ruta o cualquier cosa debajo"
 *   (semántica de directorio), y `dir/**` también incluye `dir`.
 * - Sensible a mayúsculas; admite espacios y Unicode.
 */

const cache = new Map();

function escapeRe(ch) {
  return /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
}

function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  const before = pattern.slice(0, m.index);
  const after = pattern.slice(m.index + m[0].length);
  return m[1].split(",").flatMap((alt) => expandBraces(`${before}${alt}${after}`));
}

function toRegexSource(pattern) {
  let src = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        const atStart = i === 0 || pattern[i - 1] === "/";
        const atEnd = i + 2 === pattern.length || pattern[i + 2] === "/";
        if (atStart && atEnd) {
          if (i + 2 === pattern.length) {
            // `x/**` → x y todo lo de debajo; `**` sola → todo.
            src = src.endsWith("\\/") ? `${src.slice(0, -2)}(?:\\/.*)?` : ".*";
            i += 2;
          } else {
            src += "(?:[^/]*/)*"; // `**/` → cero o más segmentos
            i += 3;
          }
          continue;
        }
        src += "[^/]*";
        i += 2;
        continue;
      }
      src += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      src += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        src += "\\[";
        i += 1;
      } else {
        let body = pattern.slice(i + 1, end).replace(/\\/g, "\\\\");
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        src += `[${body}]`;
        i = end + 1;
      }
    } else {
      src += escapeRe(ch);
      i += 1;
    }
  }
  return src;
}

function hasGlobChars(p) {
  return /[*?[\]{}]/.test(p);
}

/** Compila un glob a RegExp (memoizado). */
function compile(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  const clean = pattern.replace(/\/+$/, "");
  const alternatives = expandBraces(clean).map((p) => {
    if (p === "." || p === "") return "(?:.*)";
    return hasGlobChars(p) ? toRegexSource(p) : `${toRegexSource(p)}(?:\\/.*)?`;
  });
  const re = new RegExp(`^(?:${alternatives.join("|")})$`, "u");
  cache.set(pattern, re);
  return re;
}

function matches(pattern, relPath) {
  return compile(pattern).test(relPath);
}

/** Primer patrón que coincide, o null. */
function firstMatch(patterns, relPath) {
  for (const p of patterns || []) if (matches(p, relPath)) return p;
  return null;
}

module.exports = { compile, matches, firstMatch, hasGlobChars };
