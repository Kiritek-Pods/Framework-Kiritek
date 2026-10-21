"use strict";

/**
 * Precedencia engineering (design §6.2; T03.2–T03.4), de mayor a menor:
 *
 *   1. flags CLI allowlisted
 *   2. variables KIRITEK_ENGINEERING_* allowlisted (nunca credenciales)
 *   3. override de la unidad
 *   4. configuración del repositorio (`defaults.controls`)
 *   5. política organizacional verificada y permitida
 *   6. defaults inmutables del catálogo
 *
 * Objetos se fusionan por hoja; arrays se reemplazan. Un valor organizacional
 * `locked` no puede cambiarse desde capas superiores: falla con
 * CONFIG_CONFLICT en vez de ignorar el override. Nada de esto lee el `mode`
 * de security: los niveles engineering no se elevan ni reducen por él.
 */

const { canonicalJson } = require("../canonical.js");
const { isPlainObject, LEVELS, CONTROL_ID_RE, NAMESPACED_ID_RE } = require("../contracts/common.js");
const semver = require("../catalog/semver.js");
const { raise } = require("../errors.js");
const { assertNoSecrets } = require("./validate.js");
const { escapeSegment } = require("./provenance.js");

const ENV_PREFIX = "KIRITEK_ENGINEERING_";
const ENV_ALLOWLIST = Object.freeze(["KIRITEK_ENGINEERING_CATALOG", "KIRITEK_ENGINEERING_OFFLINE", "KIRITEK_ENGINEERING_LEVELS"]);
const FLAG_ALLOWLIST = Object.freeze(["catalog", "offline", "levels"]);
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE)/i;
const LAYER_ORDER = Object.freeze(["catalog", "organization", "repo", "unit", "env", "flag"]);

function parseBoolean(raw, where) {
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  raise("CONFIG_INVALID_OVERRIDE", `${where}: booleano inválido`, { pointer: where, remediation: "Use true/false o 1/0." });
}

function parseCatalogVersion(raw, where) {
  if (typeof raw !== "string" || !semver.isExact(raw)) {
    raise("CONFIG_INVALID_OVERRIDE", `${where}: versión de catálogo no exacta`, {
      pointer: where,
      remediation: "Use una versión semver exacta; 'latest' y rangos no se aceptan.",
    });
  }
  return raw;
}

/**
 * Niveles: `{ "<controlId>": level, "<controlId>@<unitId>": level }`,
 * o lista `["<key>=<level>", ...]`, o texto `"k=v,k=v"` (env).
 */
function parseLevels(raw, where) {
  let pairs;
  if (typeof raw === "string") {
    pairs = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split("="));
  } else if (Array.isArray(raw)) {
    pairs = raw.map((s) => String(s).split("="));
  } else if (isPlainObject(raw)) {
    pairs = Object.entries(raw);
  } else {
    raise("CONFIG_INVALID_OVERRIDE", `${where}: formato de niveles inválido`, { pointer: where });
  }
  const out = [];
  for (const pair of pairs) {
    const [key, level] = pair;
    if (pair.length !== 2 || !LEVELS.includes(level)) {
      raise("CONFIG_INVALID_OVERRIDE", `${where}: se esperaba <control>[@<unidad>]=off|warn|enforce`, { pointer: where });
    }
    const at = key.indexOf("@");
    const controlId = at === -1 ? key : key.slice(0, at);
    const unitId = at === -1 ? null : key.slice(at + 1);
    if (!CONTROL_ID_RE.test(controlId) || (unitId !== null && !NAMESPACED_ID_RE.test(unitId))) {
      raise("CONFIG_INVALID_OVERRIDE", `${where}: clave de nivel inválida "${key}"`, { pointer: where });
    }
    out.push({ controlId, unitId, level });
  }
  return out;
}

/** Overrides de flags: sólo claves allowlisted; nunca credenciales. */
function parseFlags(flags = {}) {
  if (!isPlainObject(flags)) raise("CONFIG_INVALID_OVERRIDE", "flags debe ser un objeto");
  for (const key of Object.keys(flags)) {
    if (SECRET_NAME_RE.test(key)) {
      raise("CONFIG_SECRET_REJECTED", `flag --${key}: no se aceptan credenciales por flags`, {
        remediation: "Use el secret store del proveedor/CI.",
      });
    }
    if (!FLAG_ALLOWLIST.includes(key)) {
      raise("CONFIG_FLAG_NOT_ALLOWED", `flag --${key} no está permitido para engineering/guardrails`, {
        remediation: `Flags permitidos: ${FLAG_ALLOWLIST.map((f) => `--${f}`).join(", ")}.`,
      });
    }
  }
  assertNoSecrets(flags, "flags");
  const out = {};
  if (flags.catalog !== undefined) out.catalog = parseCatalogVersion(flags.catalog, "flag:--catalog");
  if (flags.offline !== undefined) out.offline = parseBoolean(flags.offline, "flag:--offline");
  if (flags.levels !== undefined) out.levels = parseLevels(flags.levels, "flag:--level");
  return out;
}

/**
 * Variables KIRITEK_ENGINEERING_*: allowlist cerrada. Una variable no
 * reconocida con ese prefijo falla (no se ignora). Otras variables (incluidas
 * KIRITEK_MODE / KIRITEK_SECURITY de security) no se leen.
 */
function parseEnv(env = {}) {
  const out = {};
  for (const name of Object.keys(env)) {
    if (!name.startsWith(ENV_PREFIX)) continue;
    if (SECRET_NAME_RE.test(name.slice(ENV_PREFIX.length))) {
      raise("CONFIG_SECRET_REJECTED", `${name}: no se aceptan credenciales en variables KIRITEK_ENGINEERING_*`, {
        remediation: "Use el secret store del proveedor/CI.",
      });
    }
    if (!ENV_ALLOWLIST.includes(name)) {
      raise("CONFIG_ENV_NOT_ALLOWED", `${name} no está permitida`, { remediation: `Variables permitidas: ${ENV_ALLOWLIST.join(", ")}.` });
    }
    assertNoSecrets(env[name], `env:${name}`);
  }
  if (env.KIRITEK_ENGINEERING_CATALOG !== undefined) out.catalog = parseCatalogVersion(env.KIRITEK_ENGINEERING_CATALOG, "env:KIRITEK_ENGINEERING_CATALOG");
  if (env.KIRITEK_ENGINEERING_OFFLINE !== undefined) out.offline = parseBoolean(env.KIRITEK_ENGINEERING_OFFLINE, "env:KIRITEK_ENGINEERING_OFFLINE");
  if (env.KIRITEK_ENGINEERING_LEVELS !== undefined) out.levels = parseLevels(env.KIRITEK_ENGINEERING_LEVELS, "env:KIRITEK_ENGINEERING_LEVELS");
  return out;
}

/** Selecciona el nivel de override aplicable: el acotado a la unidad gana al global. */
function levelOverride(levels, controlId, unitId) {
  if (!levels) return undefined;
  const scoped = levels.filter((l) => l.controlId === controlId && l.unitId === unitId && unitId !== null);
  if (scoped.length) return scoped[scoped.length - 1].level;
  const global = levels.filter((l) => l.controlId === controlId && l.unitId === null);
  return global.length ? global[global.length - 1].level : undefined;
}

function samePointerTree(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Resuelve un control (nivel + parámetros) aplicando las capas en orden.
 *
 * @param {object} args
 * @param {string} args.basePtr        Puntero efectivo del control.
 * @param {{kind, ref, version?, setting?, locked?}[]} args.layers  En orden ascendente.
 * @param {import("./provenance.js").ProvenanceRecorder} args.recorder
 */
function resolveControlLayers({ basePtr, layers, recorder }) {
  const levelPtr = `${basePtr}/level`;
  const paramsPtr = `${basePtr}/parameters`;
  let level;
  let levelLock = null;
  const parameters = {};
  const locks = []; // { ptr, value, ref }

  const assertNotLocked = (ptr, value, layer) => {
    for (const lock of locks) {
      if (samePointerTree(ptr, lock.ptr) && (ptr !== lock.ptr || canonicalJson(value) !== canonicalJson(lock.value))) {
        raise("CONFIG_CONFLICT", `${layer.ref}: intenta cambiar ${ptr} bloqueado por la política organizacional`, {
          pointer: layer.ref,
          remediation: "La organización fijó (locked) este valor; solicite una excepción gobernada en lugar de sobrescribirlo.",
        });
      }
    }
  };

  const applyParams = (target, src, ptr, layer) => {
    for (const [k, v] of Object.entries(src)) {
      const childPtr = `${ptr}/${escapeSegment(k)}`;
      if (isPlainObject(v)) {
        if (!isPlainObject(target[k])) {
          if (target[k] !== undefined) {
            assertNotLocked(childPtr, v, layer);
            recorder.clearUnder(childPtr);
          }
          target[k] = {};
        }
        applyParams(target[k], v, childPtr, layer);
      } else {
        assertNotLocked(childPtr, v, layer);
        target[k] = JSON.parse(JSON.stringify(v));
        recorder.clearUnder(childPtr);
        recorder.record(childPtr, v, source(layer));
        if (layer.locked) locks.push({ ptr: childPtr, value: v, ref: layer.ref });
      }
    }
  };

  for (const layer of layers) {
    const s = layer.setting;
    if (!s) continue;
    if (s.level !== undefined) {
      if (levelLock && s.level !== levelLock.value) {
        raise("CONFIG_CONFLICT", `${layer.ref}: intenta cambiar el nivel de ${basePtr} bloqueado en '${levelLock.value}' por la política organizacional`, {
          pointer: layer.ref,
          remediation: "La organización fijó (locked) este nivel; no se ignora el override, se rechaza.",
        });
      }
      if (!levelLock) {
        level = s.level;
        recorder.record(levelPtr, s.level, source(layer));
      }
      if (layer.locked) levelLock = { value: s.level, ref: layer.ref };
    }
    if (s.parameters) applyParams(parameters, s.parameters, paramsPtr, layer);
  }
  return { level, parameters };
}

function source(layer) {
  const s = { sourceKind: layer.kind, sourceRef: layer.ref };
  if (layer.version !== undefined) s.sourceVersion = layer.version;
  return s;
}

module.exports = {
  ENV_PREFIX,
  ENV_ALLOWLIST,
  FLAG_ALLOWLIST,
  LAYER_ORDER,
  parseFlags,
  parseEnv,
  parseLevels,
  levelOverride,
  resolveControlLayers,
  source,
};
