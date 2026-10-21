"use strict";

/**
 * Primitivas compartidas por los contratos de engineering/guardrails.
 *
 * Diseño (R1, R5–R8, R16, R27):
 * - Sin dependencias externas; misma filosofía que `src/domain/*`.
 * - Todo constructor rechaza propiedades desconocidas, IDs no namespaceados,
 *   versiones no semver, rutas absolutas o con escapes y estados no
 *   reconocidos, en vez de normalizarlos en silencio.
 * - Los objetos resultantes se congelan en profundidad.
 * - Ningún contrato admite campos con código, prompts, queries, payloads,
 *   tokens o PII (lista ampliada respecto de `FORBIDDEN_FIELDS` security).
 *   Los contratos son cerrados (`assertKnownKeys`); el barrido profundo de
 *   campos prohibidos se aplica a las zonas libres (`facts`, `parameters`,
 *   `effectiveConfig`, payload v1). `Diagnostic.code` es un código de error,
 *   no código fuente.
 */

const { FORBIDDEN_FIELDS: SECURITY_FORBIDDEN_FIELDS } = require("../../../domain/result.js");

const PACK_ID = "engineering/guardrails";
const DOMAIN = Object.freeze({ SECURITY: "security", ENGINEERING: "engineering" });
const DOMAINS = Object.freeze(Object.values(DOMAIN));

/** Nivel configurado por control. `off` nunca equivale a conforme. */
const LEVEL = Object.freeze({ OFF: "off", WARN: "warn", ENFORCE: "enforce" });
/** Momento de ejecución (R12). */
const MOMENT = Object.freeze({ AGENT: "agent", PRE_COMMIT: "pre-commit", PR: "pr", RELEASE: "release" });
/** Confianza de una conclusión (R7.2). */
const CONFIDENCE = Object.freeze({
  DETERMINISTIC: "deterministic",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  UNKNOWN: "unknown",
});
/** Clase de evidencia. `heuristic` domina cualquier confianza nominal. */
const EVIDENCE_CLASS = Object.freeze({
  DETERMINISTIC: "deterministic",
  HEURISTIC: "heuristic",
  MANUAL: "manual",
});
const FRESHNESS = Object.freeze({ FRESH: "fresh", STALE: "stale", MISSING: "missing", CONFLICT: "conflict" });
const CACHE_STATUS = Object.freeze({ HIT: "hit", MISS: "miss", BYPASS: "bypass" });
const PROFILE_SOURCE = Object.freeze({ EXPLICIT: "explicit", INHERITED: "inherited", SUGGESTED: "suggested" });
const PROVENANCE_KIND = Object.freeze({
  FLAG: "flag",
  ENV: "env",
  UNIT: "unit",
  REPO: "repo",
  ORGANIZATION: "organization",
  CATALOG: "catalog",
  DISCOVERY: "discovery",
  INHERITED: "inherited",
});
/** Perfiles que todo catálogo base debe traer (catálogo 1.0.0). */
const CORE_PROFILES = Object.freeze(["web", "mobile-app", "search", "module-launch"]);
/** Perfiles builtin aceptados sin namespace (núcleo + los de catálogo 2.0.0, T18–T21). */
const BUILTIN_PROFILES = Object.freeze([...CORE_PROFILES, "data-views", "forms", "network-client", "feature-flags", "auth-session", "file-upload", "paginated-lists", "analytics", "destructive-actions", "localized", "offline-capable", "device-permissions", "routed-app", "dialogs", "http-api", "backend-service"]);

const LEVELS = Object.freeze(Object.values(LEVEL));
const MOMENTS = Object.freeze(Object.values(MOMENT));
const CONFIDENCES = Object.freeze(Object.values(CONFIDENCE));
const EVIDENCE_CLASSES = Object.freeze(Object.values(EVIDENCE_CLASS));
const FRESHNESSES = Object.freeze(Object.values(FRESHNESS));
const CACHE_STATUSES = Object.freeze(Object.values(CACHE_STATUS));
const PROFILE_SOURCES = Object.freeze(Object.values(PROFILE_SOURCE));
const PROVENANCE_KINDS = Object.freeze(Object.values(PROVENANCE_KIND));

/**
 * Campos prohibidos en cualquier contrato engineering: los de security más
 * los propios del dominio (queries de búsqueda, payloads remotos, tokens de
 * device/store, diffs, tool inputs, PII).
 */
const FORBIDDEN_FIELDS = Object.freeze([
  ...SECURITY_FORBIDDEN_FIELDS,
  "query",
  "queries",
  "queryText",
  "payload",
  "rawPayload",
  "response",
  "responseBody",
  "requestBody",
  "token",
  "accessToken",
  "deviceToken",
  "storeToken",
  "accountId",
  "deviceId",
  "advertisingId",
  "diff",
  "patch",
  "toolInput",
  "email",
  "phone",
  "userList",
  "users",
  "credentials",
  "password",
  "absolutePath",
]);
const FORBIDDEN_SET = new Set(FORBIDDEN_FIELDS);

// --- Patrones -------------------------------------------------------------

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SLUG = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
/** `<namespace>/<name>`: unidades, perfiles personalizados, packs. */
const NAMESPACED_ID_RE = new RegExp(`^${SLUG}/${SLUG}$`);
/** Controles: `<area>.<name>` u `<namespace>/<area>.<name>` (plugins). */
const CONTROL_ID_RE = new RegExp(`^(?:${SLUG}/)?${SLUG}(?:\\.${SLUG})+$`);
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const DIAGNOSTIC_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
const REF_RE = /^[A-Za-z0-9._\-/#:@~]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// --- Errores --------------------------------------------------------------

/** Error de contrato con código estable para auditoría/diagnóstico. */
class ContractError extends TypeError {
  constructor(message, code = "CONTRACT_INVALID") {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ContractError(message, code);
}

// --- Guardias -------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertObject(v, label) {
  if (!isPlainObject(v)) fail(`${label} debe ser un objeto`);
}

/** Rechaza propiedades desconocidas: los contratos son cerrados. */
function assertKnownKeys(obj, allowed, label) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${label}: propiedad desconocida "${key}"`, "UNKNOWN_PROPERTY");
  }
}

/** Recorre el objeto en profundidad buscando campos prohibidos. */
function assertNoForbiddenFieldsDeep(value, label, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenFieldsDeep(item, `${label}[${i}]`, seen));
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SET.has(key)) {
      fail(`${label}: campo prohibido "${key}" — el dato sensible no debe entrar al contrato`, "FORBIDDEN_FIELD");
    }
    assertNoForbiddenFieldsDeep(value[key], `${label}.${key}`, seen);
  }
}

function assertString(v, label) {
  if (typeof v !== "string" || v.trim() === "") fail(`${label} debe ser un string no vacío`);
}

function assertEnum(v, allowed, label) {
  if (!allowed.includes(v)) {
    fail(`${label} inválido: ${JSON.stringify(v)} (esperado uno de ${allowed.join(", ")})`, "UNRECOGNIZED_STATE");
  }
}

function assertBoolean(v, label) {
  if (typeof v !== "boolean") fail(`${label} debe ser boolean`);
}

function assertNonNegativeInt(v, label) {
  if (!Number.isInteger(v) || v < 0) fail(`${label} debe ser un entero >= 0`);
}

function assertPositiveInt(v, label) {
  if (!Number.isInteger(v) || v < 1) fail(`${label} debe ser un entero >= 1`);
}

function assertArray(v, label) {
  if (!Array.isArray(v)) fail(`${label} debe ser un arreglo`);
}

function assertSemver(v, label) {
  if (typeof v !== "string" || !SEMVER_RE.test(v)) {
    fail(`${label} debe ser semver exacto (sin rangos ni 'latest'): ${JSON.stringify(v)}`, "INVALID_VERSION");
  }
}

function assertNamespacedId(v, label) {
  if (typeof v !== "string" || !NAMESPACED_ID_RE.test(v)) {
    fail(`${label} debe ser un ID namespaceado '<namespace>/<nombre>': ${JSON.stringify(v)}`, "ID_NOT_NAMESPACED");
  }
}

function assertControlId(v, label) {
  if (typeof v !== "string" || !CONTROL_ID_RE.test(v)) {
    fail(`${label} debe ser un ID de control '<area>.<nombre>': ${JSON.stringify(v)}`, "ID_NOT_NAMESPACED");
  }
}

/** Perfiles: builtin (`web`, `search`...) o personalizados namespaceados. */
function assertProfileId(v, label) {
  if (BUILTIN_PROFILES.includes(v)) return;
  if (typeof v !== "string" || !NAMESPACED_ID_RE.test(v)) {
    fail(
      `${label} debe ser un perfil builtin (${BUILTIN_PROFILES.join(", ")}) o namespaceado '<namespace>/<nombre>': ${JSON.stringify(v)}`,
      "ID_NOT_NAMESPACED"
    );
  }
}

function assertSha256(v, label) {
  if (typeof v !== "string" || !SHA256_RE.test(v)) fail(`${label} debe ser 'sha256:<64 hex>'`, "INVALID_HASH");
}

function assertIso(v, label) {
  if (typeof v !== "string" || !ISO_RE.test(v) || Number.isNaN(Date.parse(v))) {
    fail(`${label} debe ser un timestamp ISO-8601 con zona`);
  }
}

function assertRef(v, label) {
  assertString(v, label);
  if (!REF_RE.test(v)) fail(`${label} contiene caracteres no permitidos para una referencia`);
  if (v.startsWith("/") || v.startsWith("~") || /^[A-Za-z]:/.test(v) || v.split("/").includes("..")) {
    fail(`${label} no puede ser absoluta ni escapar con '..'`, "ABSOLUTE_PATH");
  }
}

/**
 * Ruta relativa al repositorio, normalizada con `/`. Rechaza absolutas
 * (POSIX, Windows, UNC), `..`, backslashes, NUL y segmentos vacíos.
 * Admite espacios y Unicode (R24).
 */
function assertRepoRelativePath(v, label, { allowGlob = false } = {}) {
  assertString(v, label);
  if (v.startsWith("/") || /^[A-Za-z]:/.test(v) || v.startsWith("\\\\") || v.startsWith("~")) {
    fail(`${label} debe ser relativa al repositorio, no absoluta: ${JSON.stringify(v)}`, "ABSOLUTE_PATH");
  }
  if (v.includes("\\") || v.includes("\0")) fail(`${label} debe usar '/' y no contener NUL`, "INVALID_PATH");
  if (v === ".") return; // raíz del repositorio
  const segments = v.split("/");
  if (segments.some((s) => s === "..")) fail(`${label} no puede escapar del repositorio con '..'`, "PATH_ESCAPE");
  if (segments.some((s) => s === ".")) fail(`${label} debe estar normalizada (sin segmentos '.')`, "INVALID_PATH");
  if (segments.some((s, i) => s === "" && !(i === segments.length - 1 && segments.length > 1))) {
    fail(`${label} contiene segmentos vacíos`, "INVALID_PATH");
  }
  if (!allowGlob && /[*?[\]{}]/.test(v)) fail(`${label} no admite comodines`, "INVALID_PATH");
}

// --- Objetos comunes -------------------------------------------------------

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) deepFreeze(obj[key]);
  }
  return obj;
}

/** Copia profunda de datos JSON (rechaza funciones, undefined anidados, ciclos). */
function cloneJson(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    fail(`${label} debe ser serializable a JSON: ${err.message}`);
  }
}

/** Diagnostic: { code, message, stage?, remediation?, retryable? } */
function createDiagnostic(input, label = "diagnostic") {
  assertObject(input, label);
  assertKnownKeys(input, ["code", "message", "stage", "remediation", "retryable"], label);
  if (typeof input.code !== "string" || !DIAGNOSTIC_CODE_RE.test(input.code)) {
    fail(`${label}.code debe ser MAYÚSCULAS_CON_GUIONES_BAJOS`);
  }
  assertString(input.message, `${label}.message`);
  const out = { code: input.code, message: input.message };
  if (input.stage !== undefined) {
    assertString(input.stage, `${label}.stage`);
    out.stage = input.stage;
  }
  if (input.remediation !== undefined) {
    assertString(input.remediation, `${label}.remediation`);
    out.remediation = input.remediation;
  }
  if (input.retryable !== undefined) {
    assertBoolean(input.retryable, `${label}.retryable`);
    out.retryable = input.retryable;
  }
  return out;
}

/** Provenance: origen de un valor resuelto. */
function createProvenance(input, label = "provenance") {
  assertObject(input, label);
  assertKnownKeys(input, ["sourceKind", "sourceRef", "sourceVersion"], label);
  assertEnum(input.sourceKind, PROVENANCE_KINDS, `${label}.sourceKind`);
  assertRef(input.sourceRef, `${label}.sourceRef`);
  const out = { sourceKind: input.sourceKind, sourceRef: input.sourceRef };
  if (input.sourceVersion !== undefined) {
    assertString(input.sourceVersion, `${label}.sourceVersion`);
    out.sourceVersion = input.sourceVersion;
  }
  return out;
}

/** CatalogRef: { id, version, digest }. */
function createCatalogRef(input, label = "catalogRef") {
  assertObject(input, label);
  assertKnownKeys(input, ["id", "version", "digest"], label);
  assertNamespacedId(input.id, `${label}.id`);
  assertSemver(input.version, `${label}.version`);
  assertSha256(input.digest, `${label}.digest`);
  return { id: input.id, version: input.version, digest: input.digest };
}

/** ProfileRef: { id, version }. */
function createProfileRef(input, label = "profileRef") {
  assertObject(input, label);
  assertKnownKeys(input, ["id", "version"], label);
  assertProfileId(input.id, `${label}.id`);
  assertSemver(input.version, `${label}.version`);
  return { id: input.id, version: input.version };
}

function assertUnique(items, keyFn, label) {
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) fail(`${label}: elemento duplicado "${key}"`, "DUPLICATE");
    seen.add(key);
  }
}

module.exports = {
  PACK_ID,
  DOMAIN,
  DOMAINS,
  LEVEL,
  LEVELS,
  MOMENT,
  MOMENTS,
  CONFIDENCE,
  CONFIDENCES,
  EVIDENCE_CLASS,
  EVIDENCE_CLASSES,
  FRESHNESS,
  FRESHNESSES,
  CACHE_STATUS,
  CACHE_STATUSES,
  PROFILE_SOURCE,
  PROFILE_SOURCES,
  PROVENANCE_KIND,
  PROVENANCE_KINDS,
  BUILTIN_PROFILES,
  CORE_PROFILES,
  FORBIDDEN_FIELDS,
  SEMVER_RE,
  NAMESPACED_ID_RE,
  CONTROL_ID_RE,
  SHA256_RE,
  ContractError,
  fail,
  isPlainObject,
  assertObject,
  assertKnownKeys,
  assertNoForbiddenFieldsDeep,
  assertString,
  assertEnum,
  assertBoolean,
  assertNonNegativeInt,
  assertPositiveInt,
  assertArray,
  assertSemver,
  assertNamespacedId,
  assertControlId,
  assertProfileId,
  assertSha256,
  assertIso,
  assertRef,
  assertRepoRelativePath,
  assertUnique,
  deepFreeze,
  cloneJson,
  createDiagnostic,
  createProvenance,
  createCatalogRef,
  createProfileRef,
};
