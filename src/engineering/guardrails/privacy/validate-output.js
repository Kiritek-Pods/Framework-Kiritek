"use strict";

/**
 * Detector final y validación de salida (T08.3; design §19, pasos 4–5).
 *
 * Se ejecuta DESPUÉS de minimizar y redactar. Si encuentra credenciales,
 * PII (email, tarjeta), rutas absolutas residuales, campos prohibidos o
 * canarios registrados, la publicación falla (`REDACTION_FAILED`). El
 * mensaje describe ubicación y categoría, nunca el valor.
 */

const { validateAgainst } = require("../../../domain/schema-validator.js");
const { FORBIDDEN_FIELDS } = require("../contracts/common.js");
const { raise } = require("../errors.js");

const FORBIDDEN = new Set(FORBIDDEN_FIELDS);
const DIAG_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
const SECRET_PATTERNS = Object.freeze([
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\b(?:bearer)\s+[A-Za-z0-9._~+/-]{16,}/i,
]);
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const ABS_RE = /(^|[\s(:'"=])(\/(?:Users|home|root|var|tmp|private|etc|opt|srv|mnt|Volumes)\/|[A-Za-z]:\\)/;

function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function stringFindings(s, canaries) {
  const kinds = [];
  if (SECRET_PATTERNS.some((re) => re.test(s))) kinds.push("credential");
  if (EMAIL_RE.test(s)) kinds.push("email");
  for (const m of s.match(CARD_RE) || []) {
    const digits = m.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      kinds.push("card-number");
      break;
    }
  }
  if (ABS_RE.test(s)) kinds.push("absolute-path");
  if (canaries.some((cn) => s.includes(cn))) kinds.push("canary");
  return kinds;
}

/**
 * @returns {{where: string, kind: string}[]}
 */
function detectLeaks(value, { canaries = [] } = {}) {
  const leaks = [];
  (function walk(v, where) {
    if (typeof v === "string") {
      for (const kind of stringFindings(v, canaries)) leaks.push({ where, kind });
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN.has(k) && !(k === "code" && typeof x === "string" && DIAG_CODE_RE.test(x))) leaks.push({ where: `${where}.${k}`, kind: "forbidden-field" });
        if (canaries.some((cn) => k.includes(cn))) leaks.push({ where: `${where}.${k}`, kind: "canary" });
        walk(x, `${where}.${k}`);
      }
    }
  })(value, "$");
  return leaks;
}

function assertNoLeaks(value, opts) {
  const leaks = detectLeaks(value, opts);
  if (leaks.length) {
    raise("REDACTION_FAILED", `publicación bloqueada: ${leaks.slice(0, 6).map((l) => `${l.where} (${l.kind})`).join("; ")}`, {
      remediation: "Corrija el control/collector que emitió el dato; nada se escribe ni se envía.",
    });
  }
  return value;
}

function assertOutputSchema(value, schemaName) {
  const check = validateAgainst(schemaName, value, { extended: true });
  if (!check.valid) {
    raise("REDACTION_FAILED", `la salida no cumple ${schemaName}: ${check.errors.slice(0, 4).join("; ")}`);
  }
  return value;
}

/**
 * Barrido global de artefactos (stdout/stderr/reportes/cache/evidencia/
 * telemetría) buscando canarios y patrones prohibidos (T08.5).
 * @param {Record<string, string|Buffer>} artifacts
 */
function sweepArtifacts(artifacts, { canaries = [] } = {}) {
  const hits = [];
  for (const [name, content] of Object.entries(artifacts)) {
    const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
    for (const kind of stringFindings(text, canaries)) hits.push({ artifact: name, kind });
  }
  return hits;
}

module.exports = { detectLeaks, assertNoLeaks, assertOutputSchema, sweepArtifacts, luhn };
