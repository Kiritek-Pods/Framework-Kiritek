"use strict";

/**
 * Carga de la configuración de proyecto y resolución efectiva.
 */

const fs = require("fs");
const path = require("path");

const { assertValidConfig } = require("./validate.js");
const { resolveConfig } = require("./precedence.js");

const CONFIG_FILENAME = "kiritek-security.config.json";

/**
 * Lee la config del repo si existe. Devuelve null si no existe.
 * @throws si existe pero no es JSON válido o no cumple el schema.
 */
function loadProjectConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_FILENAME);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const e = new Error(`${CONFIG_FILENAME} no es JSON válido: ${err.message}`);
    e.code = "CONFIG_PARSE_ERROR";
    throw e;
  }
  // El `$schema` es una ayuda de editor; no es parte del contrato.
  if (parsed && typeof parsed === "object") delete parsed.$schema;
  assertValidConfig(parsed);
  return parsed;
}

/**
 * Carga + resuelve la configuración efectiva, validando el resultado.
 *
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {object} [input.flags]
 * @param {object} [input.env]
 * @returns {{ config, origin, security }}
 */
function loadEffectiveConfig(input) {
  const { repoRoot } = input;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("loadEffectiveConfig.repoRoot requerido");
  }
  const projectConfig = loadProjectConfig(repoRoot);
  const resolved = resolveConfig({ flags: input.flags, env: input.env, projectConfig });
  assertValidConfig(resolved.config);
  return resolved;
}

module.exports = { CONFIG_FILENAME, loadProjectConfig, loadEffectiveConfig };
