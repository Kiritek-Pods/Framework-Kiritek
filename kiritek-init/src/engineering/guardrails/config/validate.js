"use strict";

/**
 * Validación de la configuración engineering (R3.1, R3.7, R3.8; T03.5).
 *
 * - Schema versionado cerrado: campos/IDs/tipos desconocidos fallan con
 *   JSON Pointer y remediación.
 * - Contra el catálogo resuelto: controles, perfiles y niveles soportados.
 *   `enforce` en un control que no lo soporta es error, nunca degradación
 *   silenciosa.
 * - Credenciales: la config, los flags y el entorno nunca transportan
 *   secretos; un valor con forma de credencial se rechaza sin repetirlo.
 * - Roots y directorios: relativos y confinados al repositorio, también
 *   tras resolver symlinks.
 */

const fs = require("node:fs");
const path = require("node:path");
const { validate, validateAgainst } = require("../../../domain/schema-validator.js");
const { FORBIDDEN_FIELDS } = require("../contracts/common.js");
const { raise } = require("../errors.js");
const { pointer } = require("./provenance.js");

const SECRET_VALUE_PATTERNS = Object.freeze([
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i, // URL con usuario:clave
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /[?&](?:token|access_token|api_key|apikey|key|sig|signature|password|secret)=/i,
]);
const SECRET_KEY_RE = /(?:token|secret|passw(?:or)?d|credential|api_?key|private_?key|auth(?:orization)?)$/i;
const FORBIDDEN_KEYS = new Set(FORBIDDEN_FIELDS);

function looksLikeSecret(value) {
  return typeof value === "string" && SECRET_VALUE_PATTERNS.some((re) => re.test(value));
}

/**
 * Recorre un valor y falla ante credenciales o campos prohibidos. El
 * mensaje identifica la ubicación, nunca el valor.
 */
function assertNoSecrets(value, where, segments = []) {
  if (typeof value === "string") {
    if (looksLikeSecret(value)) {
      raise("CONFIG_SECRET_REJECTED", `${where}${segments.length ? pointer(...segments) : ""}: valor con forma de credencial`, {
        pointer: segments.length ? pointer(...segments) : where,
        remediation: "Las credenciales viven en el entorno/secret store del proveedor, nunca en config, flags ni variables KIRITEK_ENGINEERING_*.",
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, where, [...segments, i]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k) || FORBIDDEN_KEYS.has(k)) {
        raise("CONFIG_SECRET_REJECTED", `${where}${pointer(...segments, k)}: campo no permitido en configuración`, {
          pointer: pointer(...segments, k),
          remediation: "Elimine el campo; la configuración no admite credenciales ni datos de producto.",
        });
      }
      assertNoSecrets(v, where, [...segments, k]);
    }
  }
}

function schemaErrorToPointer(err) {
  // "$.workspace.units[0].id: ..." → "/workspace/units/0/id"
  const m = /^\$([^:]*):/.exec(err);
  if (!m) return "";
  return m[1].replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).map((s) => s.replace(/^\{|\}$/g, "")).map((s) => `/${s}`).join("");
}

function validateConfigSchema(document, sourceRef) {
  const check = validateAgainst("engineering/config", document, { extended: true });
  if (!check.valid) {
    const first = schemaErrorToPointer(check.errors[0]);
    raise("CONFIG_SCHEMA", `${sourceRef}: configuración inválida — ${check.errors.slice(0, 8).join("; ")}`, {
      pointer: `${sourceRef}#${first}`,
      remediation: "Ajuste la configuración a schemas/engineering/config.schema.json; propiedades desconocidas no se ignoran.",
    });
  }
}

function validateOrganizationSchema(document) {
  const check = validateAgainst("engineering/organization-policy", document, { extended: true });
  if (!check.valid) {
    raise("CONFIG_ORG_SCHEMA", `política organizacional inválida — ${check.errors.slice(0, 5).join("; ")}`, {
      remediation: "La política organizacional debe cumplir schemas/engineering/organization-policy.schema.json.",
    });
  }
}

/** Mapa control → definición del catálogo, con error accionable si no existe. */
function controlFrom(catalog, controlId, where) {
  const ctl = catalog.controls.find((c) => c.id === controlId);
  if (!ctl) {
    raise("CONFIG_UNKNOWN_CONTROL", `${where}: control desconocido "${controlId}" en el catálogo ${catalog.version}`, {
      pointer: where,
      remediation: `Controles disponibles: ${catalog.controls.map((c) => c.id).join(", ")}.`,
    });
  }
  return ctl;
}

function assertLevelSupported(ctl, level, where) {
  if (level !== undefined && !ctl.supportedLevels.includes(level)) {
    raise("CONFIG_LEVEL_UNSUPPORTED", `${where}: ${ctl.id} no soporta el nivel '${level}' (soportados: ${ctl.supportedLevels.join(", ")})`, {
      pointer: where,
      remediation:
        level === "enforce"
          ? "El control aún no tiene contrato de enforcement aprobado; use 'warn'. No se degrada silenciosamente."
          : "Use uno de los niveles soportados por el control.",
    });
  }
}

function assertParameterKeys(ctl, schema, parameters, where) {
  if (parameters === undefined) return;
  const known = Object.keys(schema.properties || {});
  for (const key of Object.keys(parameters)) {
    if (!known.includes(key)) {
      raise("CONFIG_UNKNOWN_PARAMETER", `${where}/${key}: parámetro desconocido para ${ctl.id}`, {
        pointer: `${where}/${key}`,
        remediation: `Parámetros admitidos: ${known.join(", ")}.`,
      });
    }
  }
}

function assertParametersValid(ctl, schema, parameters, where) {
  const check = validate(parameters, schema, { extended: true });
  if (!check.valid) {
    raise("CONFIG_PARAMETERS_INVALID", `${where}: parámetros inválidos para ${ctl.id} — ${check.errors.join("; ")}`, {
      pointer: where,
      remediation: "Revise el schema de parámetros publicado en el catálogo.",
    });
  }
}

function assertProfileKnown(catalog, decl, where) {
  const def = catalog.profiles.find((p) => p.id === decl.id);
  if (!def) {
    raise("CONFIG_UNKNOWN_PROFILE", `${where}: perfil "${decl.id}" no definido en el catálogo ${catalog.version}`, {
      pointer: where,
      remediation: `Perfiles disponibles: ${catalog.profiles.map((p) => p.id).join(", ")}. Los perfiles personalizados deben publicarse en un catálogo/plugin.`,
    });
  }
  if (def.version !== decl.version) {
    raise("CONFIG_PROFILE_VERSION", `${where}: perfil ${decl.id}@${decl.version} no existe; el catálogo publica ${def.version}`, {
      pointer: where,
      remediation: "Declare la versión exacta publicada; no se resuelven versiones aproximadas.",
    });
  }
}

/**
 * Confirma que `rel` (relativo al repo) no escapa del repositorio tras
 * resolver symlinks. Si no existe aún, se valida el ancestro existente.
 */
function assertConfinedToRepo(repoRoot, rel, where) {
  if (!repoRoot) return;
  const realRoot = fs.realpathSync(repoRoot);
  let probe = path.join(repoRoot, ...rel.split("/").filter((s) => s && !/[*?[\]{}]/.test(s)));
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    raise("CONFIG_PATH_OUTSIDE_REPO", `${where}: la ruta resuelve fuera del repositorio`, {
      pointer: where,
      remediation: "Las raíces y directorios deben permanecer dentro del repositorio (sin symlinks que escapen).",
    });
  }
}

/**
 * Validación semántica de la config contra el catálogo y el repo.
 * @returns {string[]} advertencias no fatales (p. ej. root aún inexistente).
 */
function validateConfigSemantics(document, snapshot, { repoRoot, sourceRef }) {
  const { catalog, parameterSchemas } = snapshot;
  const warnings = [];
  const ws = document.workspace;

  const checkControls = (controls, base) => {
    for (const [id, setting] of Object.entries(controls || {})) {
      const where = `${sourceRef}#${base}${pointer(id)}`;
      const ctl = controlFrom(catalog, id, where);
      assertLevelSupported(ctl, setting.level, `${where}/level`);
      assertParameterKeys(ctl, parameterSchemas[id], setting.parameters, `${where}/parameters`);
    }
  };
  checkControls(document.defaults && document.defaults.controls, "/defaults/controls");

  (ws.profiles || []).forEach((p, i) => assertProfileKnown(catalog, p, `${sourceRef}#/workspace/profiles/${i}`));

  const ids = new Set();
  const aliases = new Set();
  ws.units.forEach((u, i) => {
    const base = `/workspace/units/${i}`;
    if (ids.has(u.id)) raise("CONFIG_DUPLICATE_UNIT", `${sourceRef}#${base}/id: unidad duplicada "${u.id}"`, { pointer: `${sourceRef}#${base}/id` });
    ids.add(u.id);
    (u.identityAliases || []).forEach((a) => aliases.add(a));
    u.profiles.forEach((p, j) => assertProfileKnown(catalog, p, `${sourceRef}#${base}/profiles/${j}`));
    const seen = new Map();
    for (const p of u.profiles) {
      if (seen.has(p.id) && seen.get(p.id) !== p.version) {
        raise("CONFIG_AMBIGUOUS", `${sourceRef}#${base}/profiles: perfil ${p.id} declarado con dos versiones`, { pointer: `${sourceRef}#${base}/profiles` });
      }
      seen.set(p.id, p.version);
    }
    checkControls(u.controls, `${base}/controls`);
    for (const [key, rel] of [["root", u.root], ...u.owns.map((g, j) => [`owns/${j}`, g]), ...(u.excludes || []).map((g, j) => [`excludes/${j}`, g])]) {
      assertConfinedToRepo(repoRoot, rel, `${sourceRef}#${base}/${key}`);
    }
    if (repoRoot && !fs.existsSync(path.join(repoRoot, u.root))) warnings.push(`unidad ${u.id}: root ${u.root} no existe todavía`);
  });
  ws.units.forEach((u, i) => {
    for (const dep of u.dependsOn || []) {
      if (!ids.has(dep)) {
        raise("CONFIG_UNKNOWN_UNIT", `${sourceRef}#/workspace/units/${i}/dependsOn: unidad "${dep}" no declarada`, {
          pointer: `${sourceRef}#/workspace/units/${i}/dependsOn`,
          remediation: "Declare la unidad o elimine la dependencia.",
        });
      }
    }
  });
  for (const a of aliases) {
    if (ids.has(a)) raise("CONFIG_AMBIGUOUS", `${sourceRef}: el alias "${a}" coincide con una unidad declarada`);
  }

  const dirs = [
    ["/execution/cacheDirectory", document.execution && document.execution.cacheDirectory],
    ["/evidence/directory", document.evidence && document.evidence.directory],
    ...((document.exceptions && document.exceptions.waiverFiles) || []).map((g, i) => [`/exceptions/waiverFiles/${i}`, g]),
    ...((document.exceptions && document.exceptions.notApplicableFiles) || []).map((g, i) => [`/exceptions/notApplicableFiles/${i}`, g]),
    ...(ws.sharedPaths || []).map((g, i) => [`/workspace/sharedPaths/${i}`, g]),
  ];
  for (const [ptr, rel] of dirs) if (rel !== undefined) assertConfinedToRepo(repoRoot, rel, `${sourceRef}#${ptr}`);

  return warnings;
}

module.exports = {
  looksLikeSecret,
  assertNoSecrets,
  validateConfigSchema,
  validateOrganizationSchema,
  validateConfigSemantics,
  controlFrom,
  assertLevelSupported,
  assertParameterKeys,
  assertParametersValid,
};
