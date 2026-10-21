"use strict";

/**
 * Redactor obligatorio del core de seguridad Kiritek.
 *
 * Toda salida persistente o pública (reportes, evidencia, logs, telemetría,
 * comentarios de PR) debe cruzar este módulo antes de emitirse. Su trabajo:
 *
 *  1. Eliminar/sanitizar por campo los valores sensibles (secret, match,
 *     líneas fuente, prompts, código, headers de autorización, credenciales
 *     embebidas en URLs).
 *  2. Pasar un detector final de canarios: si tras redactar todavía aparece un
 *     patrón de credencial reconocible, la publicación se bloquea.
 *
 * El principio es "fail-closed": ante la duda, se redacta o se bloquea, nunca
 * se publica el valor. (Requisitos 13.3–13.5, 25.2, G.12.)
 */

const REDACTED = "[REDACTED]";

/** Campos cuyo valor nunca debe emitirse: se reemplazan por el marcador. */
const SENSITIVE_FIELDS = Object.freeze([
  "secret",
  "secretValue",
  "match",
  "matchValue",
  "sourceLine",
  "lineContent",
  "prompt",
  "code",
  "snippet",
  "rawContent",
  "value",
  "token",
  "password",
  "authorization",
  "apiKey",
  "secretAccessKey",
]);

/**
 * Patrones de canario: formas reconocibles de credenciales reales. Si el texto
 * final todavía contiene uno de estos, algo se escapó de la redacción.
 */
const CANARY_PATTERNS = Object.freeze([
  { id: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { id: "private-key-block", re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "slack-token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { id: "github-pat", re: /ghp_[0-9A-Za-z]{36}/ },
  { id: "github-fine-grained", re: /github_pat_[0-9A-Za-z_]{22,}/ },
  { id: "google-api-key", re: /AIza[0-9A-Za-z\-_]{35}/ },
  { id: "jwt", re: /eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/ },
]);

/**
 * Sanitiza una URL: elimina `user:pass@`, parámetros de query con nombres
 * sospechosos y fragmentos. No lanza ante URLs malformadas.
 */
function sanitizeUrl(value) {
  // user:pass@host → host
  let out = value.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, `$1${REDACTED}@`);
  // query params sensibles: token=, key=, secret=, password=, access_token=
  out = out.replace(
    /([?&](?:access_?token|token|api[_-]?key|key|secret|password|pwd|sig|signature)=)[^&#\s]+/gi,
    `$1${REDACTED}`
  );
  return out;
}

/**
 * Sanitiza texto libre: cabeceras de autorización y URLs con credenciales.
 */
function sanitizeText(value) {
  if (typeof value !== "string") return value;
  let out = value;
  // Authorization: Bearer xxx / Basic xxx
  out = out.replace(/(authorization\s*:\s*)(bearer|basic|token)\s+\S+/gi, `$1$2 ${REDACTED}`);
  // URLs con posibles credenciales
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (m) => sanitizeUrl(m));
  return out;
}

/**
 * Redacta recursivamente un valor. Objetos y arreglos se recorren; los campos
 * sensibles se reemplazan por el marcador; los strings se sanitizan.
 */
function redactValue(value, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (SENSITIVE_FIELDS.includes(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue(v, seen);
      }
    }
    return out;
  }
  return value;
}

/**
 * Devuelve un objeto/valor redactado (copia; no muta la entrada).
 */
function redact(value) {
  return redactValue(value, new WeakSet());
}

/**
 * Busca canarios en un texto ya redactado.
 * @returns {string[]} ids de los patrones encontrados (vacío si limpio).
 */
function findCanaries(text) {
  if (typeof text !== "string") return [];
  const hits = [];
  for (const { id, re } of CANARY_PATTERNS) {
    if (re.test(text)) hits.push(id);
  }
  return hits;
}

/**
 * Serializa un valor de forma segura: lo redacta, lo serializa a JSON y pasa el
 * detector final de canarios. Si queda un canario, lanza y NO devuelve texto,
 * de modo que una publicación nunca filtre el valor.
 *
 * @returns {{ json: string, redacted: object }}
 */
function safeSerialize(value) {
  const redacted = redact(value);
  const json = JSON.stringify(redacted, null, 2);
  const canaries = findCanaries(json);
  if (canaries.length > 0) {
    const err = new Error(
      `redacción insuficiente: patrón(es) de canario detectado(s) tras redactar: ${canaries.join(", ")}`
    );
    err.code = "REDACTION_FAILED";
    err.canaries = canaries;
    throw err;
  }
  return { json, redacted };
}

module.exports = {
  REDACTED,
  SENSITIVE_FIELDS,
  CANARY_PATTERNS,
  redact,
  sanitizeText,
  sanitizeUrl,
  findCanaries,
  safeSerialize,
};
