"use strict";

/**
 * Clasificación de archivos sensibles y detección de placeholders seguros.
 *
 * Dos señales independientes que el motor combina:
 *  - clasificación por RUTA: ¿la ruta parece contener secretos por su nombre
 *    (.env, *.pem, credentials.json, secrets/…)?
 *  - señal de CONTENIDO: ¿el contenido tiene material secreto real, o sólo
 *    placeholders seguros?
 *
 * Regla clave (requisito 5.3): la allowlist por ruta (ej. `.env.example`) NUNCA
 * anula el análisis de contenido. Un archivo "permitido" por nombre con un
 * secreto real se bloquea igual.
 *
 * (Requisitos 5.1–5.6, G.4.)
 */

const path = require("path");
const { findCanaries } = require("../scanners/redactor.js");

/** Categorías de sensibilidad por ruta. */
const CATEGORY = Object.freeze({
  ENV: "env-file",
  PRIVATE_KEY: "private-key",
  CERT_KEY: "key-file",
  CREDENTIALS: "credentials-file",
  SECRETS_DIR: "secrets-dir",
  EXAMPLE: "example-file",
  NONE: "none",
});

/** Rutas de ejemplo permitidas (si el contenido es limpio). */
const EXAMPLE_SUFFIXES = Object.freeze([".example", ".sample", ".dist", ".template"]);

/** Patrones de placeholder seguro (valores inequívocamente ficticios). */
const PLACEHOLDER_PATTERNS = Object.freeze([
  /\byour[_-]?[a-z0-9]*[_-]?(?:key|token|secret|password)\b/i,
  /\bexample\b/i,
  /\bchangeme\b/i,
  /\breplace[_-]?me\b/i,
  /<[^>]+>/, // <REPLACE_ME>
  /\$\{[^}]+\}/, // ${VAR}
  /\bxx+\b/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /\bredacted\b/i,
]);

function normalizeName(relPath) {
  // Normaliza separadores y lleva a minúsculas para comparaciones de nombre.
  return relPath.replace(/\\/g, "/");
}

/**
 * Clasifica una ruta por su nombre (no mira el contenido).
 * @returns {{ category: string, isExample: boolean }}
 */
function classifyPath(relPath) {
  const p = normalizeName(relPath);
  const lower = p.toLowerCase();
  const base = path.posix.basename(lower);

  const isExample = EXAMPLE_SUFFIXES.some((s) => base.endsWith(s)) || /\.(example|sample|dist|template)\./.test(base);

  // secrets/ en cualquier segmento
  if (lower.split("/").includes("secrets")) {
    return { category: CATEGORY.SECRETS_DIR, isExample };
  }
  // .env y .env.*  (pero .env.example es ejemplo)
  if (base === ".env" || base.startsWith(".env.")) {
    return { category: isExample ? CATEGORY.EXAMPLE : CATEGORY.ENV, isExample };
  }
  if (base.endsWith(".pem")) {
    return { category: isExample ? CATEGORY.EXAMPLE : CATEGORY.PRIVATE_KEY, isExample };
  }
  if (base.endsWith(".key")) {
    return { category: isExample ? CATEGORY.EXAMPLE : CATEGORY.CERT_KEY, isExample };
  }
  if (base === "credentials.json" || base === "credentials") {
    return { category: isExample ? CATEGORY.EXAMPLE : CATEGORY.CREDENTIALS, isExample };
  }
  return { category: isExample ? CATEGORY.EXAMPLE : CATEGORY.NONE, isExample };
}

/**
 * ¿El contenido parece contener SÓLO placeholders seguros (sin material real)?
 * Devuelve false si detecta un canario real o entropía de secreto.
 */
function isPlaceholderOnly(content) {
  if (typeof content !== "string" || content.trim() === "") return true;
  // Si hay un canario de credencial real, no es placeholder.
  if (findCanaries(content).length > 0) return false;

  // Analizar valores asignados (clave=valor / clave: valor).
  const assignmentRe = /(?:^|\n)\s*[A-Za-z0-9_.-]+\s*[:=]\s*["']?([^"'\n#]+)["']?/g;
  let m;
  let sawValue = false;
  while ((m = assignmentRe.exec(content)) !== null) {
    const value = m[1].trim();
    if (value === "") continue;
    sawValue = true;
    const looksPlaceholder = PLACEHOLDER_PATTERNS.some((re) => re.test(value));
    if (!looksPlaceholder && looksLikeSecret(value)) {
      return false;
    }
  }
  return sawValue ? true : true;
}

/**
 * Heurística: ¿un valor parece un secreto real (alta entropía / longitud)?
 */
function looksLikeSecret(value) {
  const v = value.trim();
  if (v.length < 16) return false;
  // Muchos caracteres alfanuméricos seguidos sin espacios → sospechoso.
  const noSpaces = !/\s/.test(v);
  const alnumHeavy = /^[A-Za-z0-9/_+=.-]+$/.test(v);
  const hasMixedCaseDigits = /[a-z]/.test(v) && /[A-Z0-9]/.test(v);
  return noSpaces && alnumHeavy && hasMixedCaseDigits;
}

/**
 * Evalúa una ruta + contenido opcional y devuelve la señal combinada.
 *
 * @param {string} relPath
 * @param {string} [content]
 * @returns {{ category, isExample, contentHasSecret, sensitive }}
 */
function evaluateFile(relPath, content) {
  const { category, isExample } = classifyPath(relPath);
  const contentHasSecret = content !== undefined ? !isPlaceholderOnly(content) : false;

  // Sensible si:
  //  - la ruta es sensible y no es ejemplo, O
  //  - el contenido tiene un secreto real (aunque la ruta sea "ejemplo").
  const pathSensitive = category !== CATEGORY.NONE && category !== CATEGORY.EXAMPLE;
  const sensitive = pathSensitive || contentHasSecret;

  return { category, isExample, contentHasSecret, sensitive };
}

module.exports = {
  CATEGORY,
  EXAMPLE_SUFFIXES,
  PLACEHOLDER_PATTERNS,
  classifyPath,
  isPlaceholderOnly,
  looksLikeSecret,
  evaluateFile,
};
