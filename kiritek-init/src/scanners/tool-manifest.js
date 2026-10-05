"use strict";

/**
 * Validación de política de supply chain sobre el manifiesto de herramientas.
 *
 * Más allá del schema (forma), aquí se aplican las REGLAS de seguridad:
 *  - versión exacta: nada de `latest`, rangos (`^`, `~`, `*`, `x`) ni tags
 *    mutables.
 *  - URL en HTTPS y dentro de hosts permitidos.
 *  - SHA-256 presente y con forma de hash hex de 64 chars (no placeholder sin
 *    marcar) — un placeholder explícito se reporta como "pin pendiente", no
 *    como válido.
 *  - sin plataformas/arquitecturas duplicadas por herramienta.
 *
 * (Requisitos 2.1–2.3, 24.1–24.5.)
 */

const { validateAgainst } = require("../domain/schema-validator.js");

/** Hosts desde los que se permite descargar binarios. */
const ALLOWED_HOSTS = Object.freeze(["github.com", "objects.githubusercontent.com"]);

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MUTABLE_TOKENS = Object.freeze(["latest", "stable", "main", "master", "head"]);
const RANGE_CHARS = Object.freeze(["^", "~", "*", "x", "X", ">", "<", "=", " ", "|"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const PLACEHOLDER_RE = /REPLACE|TODO|PENDING|XXXX/i;

function isExactVersion(version) {
  if (typeof version !== "string") return false;
  const lower = version.toLowerCase();
  if (MUTABLE_TOKENS.includes(lower)) return false;
  if (RANGE_CHARS.some((c) => version.includes(c))) return false;
  return EXACT_VERSION_RE.test(version);
}

function hostAllowed(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return ALLOWED_HOSTS.includes(parsed.hostname);
}

/**
 * Valida el manifiesto completo.
 *
 * @param {object} manifest
 * @returns {{ valid: boolean, errors: string[], pendingPins: string[] }}
 *   `pendingPins` lista artefactos con checksum placeholder (no bloquea en el
 *   validador, pero sí lo hará la cache antes de ejecutar: no se usa un binario
 *   sin SHA-256 real).
 */
function validateManifest(manifest) {
  const errors = [];
  const pendingPins = [];

  const schemaCheck = validateAgainst("tool-manifest", manifest);
  if (!schemaCheck.valid) {
    return { valid: false, errors: schemaCheck.errors, pendingPins };
  }

  for (const tool of manifest.tools) {
    if (!isExactVersion(tool.version)) {
      errors.push(`${tool.name}: versión no exacta "${tool.version}" (prohibido latest/rangos/tags mutables)`);
    }
    if (tool.provenance && !hostAllowed(tool.provenance)) {
      errors.push(`${tool.name}: provenance fuera de hosts permitidos: ${tool.provenance}`);
    }

    const seen = new Set();
    for (const art of tool.artifacts || []) {
      const key = `${art.platform}/${art.arch}`;
      if (seen.has(key)) {
        errors.push(`${tool.name}: plataforma/arquitectura duplicada: ${key}`);
      }
      seen.add(key);

      if (!hostAllowed(art.url)) {
        errors.push(`${tool.name} ${key}: URL no permitida o no HTTPS: ${art.url}`);
      }
      if (PLACEHOLDER_RE.test(art.sha256)) {
        pendingPins.push(`${tool.name} ${key}`);
      } else if (!SHA256_RE.test(art.sha256)) {
        errors.push(`${tool.name} ${key}: sha256 inválido (se espera hex de 64 chars)`);
      }
    }
  }

  return { valid: errors.length === 0, errors, pendingPins };
}

/**
 * Busca el artefacto para una plataforma/arquitectura concretas.
 * @returns {object|null}
 */
function findArtifact(manifest, toolName, platform, arch) {
  const tool = (manifest.tools || []).find((t) => t.name === toolName);
  if (!tool) return null;
  const art = (tool.artifacts || []).find((a) => a.platform === platform && a.arch === arch);
  if (!art) return null;
  return { version: tool.version, ...art };
}

module.exports = {
  ALLOWED_HOSTS,
  isExactVersion,
  hostAllowed,
  validateManifest,
  findArtifact,
  SHA256_RE,
  PLACEHOLDER_RE,
};
