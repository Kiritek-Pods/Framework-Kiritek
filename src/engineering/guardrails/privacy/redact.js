"use strict";

/**
 * Redacción (T08.2; design §19, pasos 2–3).
 *
 * - Eliminación por campos: claves prohibidas (código, queries, payloads,
 *   prompts, tokens, PII, diffs…) se quitan en cualquier profundidad. `code`
 *   sólo se conserva si es un código de diagnóstico (MAYÚSCULAS_CON_GUIONES).
 * - Sanitización de strings: URLs sin credenciales/query/fragmento,
 *   cabeceras de autorización, rutas absolutas → relativas al repo o
 *   marcador. Los datos que no se pueden sanear con seguridad (credenciales,
 *   emails, tarjetas) NO se tocan aquí: el detector final los rechaza.
 */

const path = require("node:path");
const { FORBIDDEN_FIELDS } = require("../contracts/common.js");

const FORBIDDEN = new Set(FORBIDDEN_FIELDS);
const DIAG_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const AUTH_HEADER_RE = /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*[^\s,;]+(?:\s+[^\s,;]+)?/gi;
const POSIX_ABS_RE = /(^|[\s(:'"=])(\/(?:Users|home|root|var|tmp|private|etc|opt|srv|mnt|Volumes|workspace|github|builds?)\/[^\s"'),;]*)/g;
const WIN_ABS_RE = /(^|[\s(:'"=])([A-Za-z]:\\[^\s"'),;]*)/g;

function removeForbiddenFields(value, where = "$", removed = []) {
  if (Array.isArray(value)) return { value: value.map((v, i) => removeForbiddenFields(v, `${where}[${i}]`, removed).value), removed };
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k) && !(k === "code" && typeof v === "string" && DIAG_CODE_RE.test(v))) {
        removed.push(`${where}.${k}`);
        continue;
      }
      out[k] = removeForbiddenFields(v, `${where}.${k}`, removed).value;
    }
    return { value: out, removed };
  }
  return { value, removed };
}

function sanitizeUrl(text) {
  try {
    const u = new URL(text);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (_) {
    return "[url-redactada]";
  }
}

function relativizePath(abs, repoRoot) {
  if (repoRoot) {
    const rel = path.relative(repoRoot, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  }
  return "[ruta-absoluta]";
}

function sanitizeString(text, opts = {}) {
  let s = text.replace(AUTH_HEADER_RE, (m, name) => `${name}: [redactado]`);
  s = s.replace(URL_RE, (u) => sanitizeUrl(u));
  s = s.replace(POSIX_ABS_RE, (m, pre, p) => `${pre}${relativizePath(p, opts.repoRoot)}`);
  s = s.replace(WIN_ABS_RE, (m, pre, p) => `${pre}${relativizePath(p, opts.repoRoot)}`);
  if (opts.repoRoot && s.includes(opts.repoRoot)) s = s.split(opts.repoRoot).join(".");
  return s;
}

function sanitizeStrings(value, opts = {}) {
  if (typeof value === "string") return sanitizeString(value, opts);
  if (Array.isArray(value)) return value.map((v) => sanitizeStrings(v, opts));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeStrings(v, opts)]));
  return value;
}

module.exports = { removeForbiddenFields, sanitizeString, sanitizeStrings, sanitizeUrl };
