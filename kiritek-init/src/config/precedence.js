"use strict";

/**
 * Resolución de configuración con precedencia:
 *
 *   flags > variables KIRITEK_* > config de proyecto > defaults
 *
 * Devuelve la configuración efectiva más un mapa de "origen" por clave, para
 * poder explicar de dónde salió cada valor (sin imprimir secretos: aquí no se
 * manejan credenciales, que viven en el entorno/secret store).
 */

const { DEFAULT_CONFIG, clone } = require("./defaults.js");

/**
 * Mapa de clave efectiva (dot-path) → cómo se parsea desde flag/env.
 * `type` indica la coerción; `path` es la ruta en el objeto de config.
 */
const SETTINGS = Object.freeze([
  { key: "mode", path: ["mode"], type: "enum", values: ["warning", "enforce"], flag: "mode", env: "KIRITEK_MODE" },
  { key: "security", path: ["__security"], type: "enum", values: ["warning", "enforce", "off"], flag: "security", env: "KIRITEK_SECURITY" },
  { key: "gitleaks-version", path: ["secrets", "gitleaksVersion"], type: "string", flag: "gitleaks-version", env: "KIRITEK_GITLEAKS_VERSION" },
  { key: "history-depth", path: ["secrets", "historyDepth"], type: "enum", values: ["full", "shallow"], flag: "history-depth", env: "KIRITEK_HISTORY_DEPTH" },
  { key: "default-branch", path: ["defaultBranch", "explicit"], type: "string", flag: "default-branch", env: "KIRITEK_DEFAULT_BRANCH" },
  { key: "block-direct-push", path: ["git", "blockDirectDefaultPush"], type: "boolean", flag: "block-direct-push", env: "KIRITEK_BLOCK_DIRECT_PUSH" },
  { key: "force-policy", path: ["git", "forcePolicy"], type: "enum", values: ["deny", "lease-only", "allow"], flag: "force-policy", env: "KIRITEK_FORCE_POLICY" },
  { key: "commits", path: ["commits", "enabled"], type: "boolean", flag: "commits", env: "KIRITEK_COMMITS" },
  { key: "jira", path: ["jira", "enabled"], type: "boolean", flag: "jira", env: "KIRITEK_JIRA" },
  { key: "jira-key-pattern", path: ["jira", "keyPattern"], type: "string", flag: "jira-key-pattern", env: "KIRITEK_JIRA_KEY_PATTERN" },
  { key: "jira-fallback", path: ["jira", "unavailable"], type: "enum", values: ["fail-closed", "warn"], flag: "jira-fallback", env: "KIRITEK_JIRA_FALLBACK" },
  { key: "jira-base-url", path: ["jira", "baseUrl"], type: "string", flag: "jira-base-url", env: "KIRITEK_JIRA_BASE_URL" },
  { key: "report-dir", path: ["evidence", "directory"], type: "string", flag: "report-dir", env: "KIRITEK_REPORT_DIR" },
  { key: "telemetry", path: ["telemetry", "enabled"], type: "boolean", flag: "telemetry", env: "KIRITEK_TELEMETRY" },
]);

function coerce(setting, raw) {
  if (setting.type === "boolean") {
    if (raw === true || raw === "true" || raw === "1") return true;
    if (raw === false || raw === "false" || raw === "0") return false;
    throw new Error(`valor booleano inválido para ${setting.key}: ${JSON.stringify(raw)}`);
  }
  if (setting.type === "enum") {
    if (!setting.values.includes(raw)) {
      throw new Error(`valor inválido para ${setting.key}: ${JSON.stringify(raw)} (uno de ${setting.values.join(", ")})`);
    }
    return raw;
  }
  // string
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`valor de texto inválido para ${setting.key}`);
  }
  return raw;
}

function setPath(obj, pathArr, value) {
  let node = obj;
  for (let i = 0; i < pathArr.length - 1; i += 1) {
    const seg = pathArr[i];
    if (typeof node[seg] !== "object" || node[seg] === null) node[seg] = {};
    node = node[seg];
  }
  node[pathArr[pathArr.length - 1]] = value;
}

/**
 * Resuelve la configuración efectiva.
 *
 * @param {object} input
 * @param {object} [input.flags]        Flags ya parseados (clave → valor).
 * @param {object} [input.env]          Variables de entorno (default process.env).
 * @param {object|null} [input.projectConfig] Config del repo ya cargada o null.
 * @returns {{ config: object, origin: object, security: string|null }}
 */
function resolveConfig(input = {}) {
  const flags = input.flags || {};
  const env = input.env || process.env;
  const projectConfig = input.projectConfig || null;

  const config = clone(DEFAULT_CONFIG);
  const origin = {};

  // 1. config de proyecto sobre defaults.
  //
  // La config de proyecto ya fue validada contra el schema (additionalProperties
  // controlado), así que es seguro fusionarla en profundidad sobre los defaults.
  // Esto preserva TODOS los campos anidados (p. ej. jira.requireCredentials,
  // jira.cacheTtlSeconds), no sólo los que tienen flag/env en SETTINGS.
  if (projectConfig && typeof projectConfig === "object") {
    deepMerge(config, projectConfig);
    for (const setting of SETTINGS) {
      if (setting.path[0] === "__security") continue; // security es sólo flag/env
      const val = readPath(projectConfig, setting.path);
      origin[setting.key] = val !== undefined ? "project" : "default";
    }
  } else {
    for (const setting of SETTINGS) {
      if (setting.path[0] !== "__security") origin[setting.key] = "default";
    }
  }

  let security = null;

  // 2. env, luego 3. flags (mayor precedencia). Se aplican en ese orden.
  for (const [sourceName, source] of [["env", env], ["flag", flags]]) {
    for (const setting of SETTINGS) {
      const rawKey = sourceName === "env" ? setting.env : setting.flag;
      if (!Object.prototype.hasOwnProperty.call(source, rawKey)) continue;
      const value = coerce(setting, source[rawKey]);
      if (setting.path[0] === "__security") {
        security = value;
        origin.security = sourceName;
        continue;
      }
      setPath(config, setting.path, value);
      origin[setting.key] = sourceName;
    }
  }

  // `--security=off` fuerza un modo lógico; se refleja aparte para que el CLI
  // exija confirmación y marque la instalación como no conforme.
  if (security === "warning" || security === "enforce") {
    config.mode = security;
    if (origin.security) origin.mode = origin.security;
  }

  return { config, origin, security };
}

/**
 * Fusiona `src` sobre `dst` en profundidad para objetos planos. Los arreglos y
 * valores escalares reemplazan por completo (no se concatenan). No sigue
 * prototipos ni fusiona objetos no planos.
 */
function deepMerge(dst, src) {
  for (const key of Object.keys(src)) {
    const sv = src[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv)) {
      if (!dst[key] || typeof dst[key] !== "object" || Array.isArray(dst[key])) dst[key] = {};
      deepMerge(dst[key], sv);
    } else {
      dst[key] = sv;
    }
  }
  return dst;
}

function readPath(obj, pathArr) {
  let node = obj;
  for (const seg of pathArr) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[seg];
  }
  return node;
}

module.exports = { resolveConfig, SETTINGS };
