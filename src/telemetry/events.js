"use strict";

/**
 * Constructor y saneado de eventos de telemetría del core de seguridad Kiritek
 * (Tarea 34, requisitos 13.6–13.7, 25.1–25.6, 26.6, G.12).
 *
 * Principios no negociables:
 *  - Telemetría LOCAL siempre estructurada y mínima: control, versión, modo,
 *    duración, alcance AGREGADO (contadores, nunca rutas), resultado y
 *    categoría de error. (25.1)
 *  - Un evento NUNCA contiene contenido de archivos, secretos, prompts, diffs,
 *    nombres de personas, URL completa del repo, rutas absolutas ni URLs con
 *    credenciales. El saneado reutiliza el redactor obligatorio del core y
 *    añade stripping explícito de rutas absolutas y repo URLs, más un barrido
 *    final anti-canario/PII. Si algo se escapa, se bloquea (fail-closed). (25.2, 26.6, G.12)
 *  - Las dimensiones de cumplimiento (instalación, cobertura, recencia,
 *    hallazgos, enforcement) se exponen SEPARADAS, nunca colapsadas en un
 *    único booleano engañoso. (25.4)
 *  - El exceso de presupuesto de duración se REGISTRA como degradación; jamás
 *    implica omitir un control. (25.5)
 *  - `clock` e `idGenerator` son inyectables para pruebas deterministas.
 *
 * Este módulo es puro: construye y sanea objetos. La entrega (local/remota) la
 * maneja `transport.js`.
 */

const redactor = require("../scanners/redactor.js");

const EVENT_SCHEMA_VERSION = 1;

/** Categorías de resultado permitidas en un evento (alineadas con DECISION). */
const RESULT_CATEGORIES = Object.freeze(["allow", "warn", "deny", "error", "skip"]);

/** Categorías de error permitidas (nunca el mensaje crudo). */
const ERROR_CATEGORIES = Object.freeze([
  "none",
  "tool_unavailable",
  "integrity_failed",
  "incompatible",
  "timeout",
  "config_invalid",
  "internal",
  "network",
  "unknown",
]);

/** Tipos de evento soportados. */
const EVENT_TYPES = Object.freeze(["control_run", "alert"]);

/** Categorías de alerta agregada (tool/Jira/bypass/excepciones). (25.6) */
const ALERT_CATEGORIES = Object.freeze([
  "tool_errors",
  "jira_failures",
  "bypasses",
  "expired_exceptions",
  "ci_failures",
]);

/**
 * Patrones de PII/datos sensibles que NO deben aparecer en un evento. El
 * barrido es defensivo: complementa la redacción por campo con una detección
 * final sobre el JSON serializado. (25.2, 26.6)
 */
const PII_PATTERNS = Object.freeze([
  // Direcciones de correo.
  { id: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  // Rutas absolutas POSIX (p. ej. /Users/alice/..., /home/bob/...).
  { id: "abs-path-posix", re: /(?:^|["'\s:=(])\/(?:Users|home|root|var|tmp|opt|etc|private)\// },
  // Rutas absolutas Windows (C:\Users\...).
  { id: "abs-path-win", re: /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/ },
  // URL de repositorio git (https o ssh) — forma completa que revela el origen.
  { id: "repo-url-https", re: /https?:\/\/[^\s"']*\.git\b/ },
  { id: "repo-url-ssh", re: /\bgit@[^\s"':]+:[^\s"']+/ },
]);

/** Marcador para valores agregados que fueron retirados por saneado. */
const STRIPPED = "[STRIPPED]";

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} debe ser un entero >= 0`);
  }
}

let eventCounter = 0;
const defaultClock = () => new Date().toISOString();
const defaultIdGenerator = () => {
  eventCounter += 1;
  return `evt-${Date.now().toString(36)}-${eventCounter.toString(36)}`;
};

/**
 * Elimina rutas absolutas y URLs de repositorio de un string libre, además de
 * delegar el saneado de credenciales/URL/Authorization al redactor del core.
 * Reemplaza por marcadores en vez de dejar rastro parcial.
 */
function stripSensitiveText(value) {
  if (typeof value !== "string") return value;
  let out = redactor.sanitizeText(value);
  // URLs de repo (.git) completas → marcador.
  out = out.replace(/https?:\/\/\S*\.git\b/gi, STRIPPED);
  out = out.replace(/\bgit@[^\s"':]+:[^\s"']+/gi, STRIPPED);
  // Rutas absolutas POSIX y Windows → marcador (no revelar layout del disco).
  out = out.replace(/\/(?:Users|home|root|var|tmp|opt|etc|private)\/[^\s"']*/g, STRIPPED);
  out = out.replace(/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"']*/g, STRIPPED);
  return out;
}

/**
 * Normaliza el alcance a su forma AGREGADA: sólo contadores, nunca rutas ni
 * nombres. Acepta un objeto con contadores enteros no negativos y los copia.
 */
function normalizeAggregateScope(scope) {
  if (scope === undefined || scope === null) return undefined;
  if (typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("event.scope agregado debe ser un objeto de contadores");
  }
  const out = {};
  for (const [key, raw] of Object.entries(scope)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new TypeError(`event.scope.${key} debe ser numérico (contador agregado)`);
    }
    assertNonNegativeInteger(raw, `event.scope.${key}`);
    out[key] = raw;
  }
  return out;
}

/**
 * Construye las cinco dimensiones de cumplimiento SEPARADAS. Nunca se colapsan
 * en un booleano. Cada dimensión es independiente y explícita. (25.4)
 *
 * @param {object} d
 * @param {boolean} d.installed    ¿el control está instalado?
 * @param {number}  d.coverage     cobertura 0..1 (fracción evaluada).
 * @param {boolean} d.recentRun    ¿hubo ejecución reciente/vigente?
 * @param {number}  d.findings     cantidad de hallazgos (agregado).
 * @param {string}  d.enforcement  "warning" | "enforce" | "off".
 */
function buildDimensions(d = {}) {
  const dims = {};
  dims.installed = d.installed === true;
  if (d.coverage !== undefined) {
    if (typeof d.coverage !== "number" || d.coverage < 0 || d.coverage > 1) {
      throw new TypeError("dimensions.coverage debe ser un número 0..1");
    }
    dims.coverage = d.coverage;
  } else {
    dims.coverage = 0;
  }
  dims.recentRun = d.recentRun === true;
  const findings = d.findings === undefined ? 0 : d.findings;
  assertNonNegativeInteger(findings, "dimensions.findings");
  dims.findings = findings;
  const enforcement = d.enforcement === undefined ? "warning" : d.enforcement;
  if (!["warning", "enforce", "off"].includes(enforcement)) {
    throw new TypeError("dimensions.enforcement debe ser warning|enforce|off");
  }
  dims.enforcement = enforcement;
  // `collapsed: null` documenta explícitamente que NO se expone un booleano
  // único que resuma las cinco dimensiones. Viven siempre por separado. (25.4)
  dims.collapsed = null;
  return dims;
}

/**
 * Construye un evento LOCAL estructurado para una ejecución de control. (25.1)
 *
 * @param {object} input
 * @param {string}  input.control        id del control (p. ej. "gitleaks.staged").
 * @param {string}  input.version        versión efectiva de la herramienta/core.
 * @param {string}  input.mode           "warning" | "enforce" | "off".
 * @param {number}  input.durationMs     duración en ms (entero >= 0).
 * @param {object}  [input.scope]        alcance AGREGADO (contadores).
 * @param {string}  input.result         RESULT_CATEGORIES.
 * @param {string}  [input.errorCategory] ERROR_CATEGORIES (default "none").
 * @param {object}  [input.dimensions]   dimensiones separadas (25.4).
 * @param {object}  [input.budget]       { budgetMs, overBudget, degraded }.
 * @param {object}  [deps]               { clock, idGenerator }.
 */
function buildControlEvent(input, deps = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("buildControlEvent requiere un objeto");
  }
  const clock = deps.clock || defaultClock;
  const idGenerator = deps.idGenerator || defaultIdGenerator;

  assertNonEmptyString(input.control, "event.control");
  assertNonEmptyString(input.version, "event.version");
  if (!["warning", "enforce", "off"].includes(input.mode)) {
    throw new TypeError("event.mode debe ser warning|enforce|off");
  }
  assertNonNegativeInteger(input.durationMs, "event.durationMs");
  if (!RESULT_CATEGORIES.includes(input.result)) {
    throw new TypeError(`event.result inválido: ${JSON.stringify(input.result)}`);
  }
  const errorCategory = input.errorCategory === undefined ? "none" : input.errorCategory;
  if (!ERROR_CATEGORIES.includes(errorCategory)) {
    throw new TypeError(`event.errorCategory inválido: ${JSON.stringify(errorCategory)}`);
  }

  const event = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: input.id === undefined ? idGenerator() : input.id,
    type: "control_run",
    control: input.control,
    version: input.version,
    mode: input.mode,
    durationMs: input.durationMs,
    result: input.result,
    errorCategory,
    createdAt: input.createdAt === undefined ? clock() : input.createdAt,
  };
  assertNonEmptyString(event.id, "event.id");

  const scope = normalizeAggregateScope(input.scope);
  if (scope !== undefined) event.scope = scope;

  event.dimensions = buildDimensions(input.dimensions || {});

  // Presupuesto de duración: se registra el exceso como degradación, nunca
  // como señal para omitir un control. (25.5)
  if (input.budget !== undefined) {
    event.budget = buildBudget(input.budget, input.durationMs);
  }

  return sanitizeEvent(event);
}

/**
 * Registra el estado del presupuesto de duración. El control YA se ejecutó: el
 * exceso sólo produce una marca de degradación + guía de optimización. (25.5)
 */
function buildBudget(budget, durationMs) {
  if (!budget || typeof budget !== "object") {
    throw new TypeError("event.budget debe ser un objeto");
  }
  assertNonNegativeInteger(budget.budgetMs, "budget.budgetMs");
  const overBudget = durationMs > budget.budgetMs;
  return {
    budgetMs: budget.budgetMs,
    overBudget,
    // La degradación es informativa; el control nunca se omite por ello.
    degraded: overBudget,
    controlSkipped: false,
    guidance: overBudget
      ? "duración por encima del presupuesto; considerar reducir alcance o cachear"
      : "dentro del presupuesto",
  };
}

/**
 * Construye un evento de ALERTA AGREGADA (tool/Jira/bypass/excepciones/CI). Sólo
 * contadores y categorías, nunca datos sensibles. (25.6)
 *
 * @param {object} input
 * @param {string} input.category   ALERT_CATEGORIES.
 * @param {number} input.count      cantidad agregada (entero >= 0).
 * @param {string} [input.window]   ventana descriptiva ("24h", "last-run"...).
 * @param {string} [input.severity] severidad informativa.
 */
function buildAlertEvent(input, deps = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("buildAlertEvent requiere un objeto");
  }
  const clock = deps.clock || defaultClock;
  const idGenerator = deps.idGenerator || defaultIdGenerator;

  if (!ALERT_CATEGORIES.includes(input.category)) {
    throw new TypeError(`alert.category inválida: ${JSON.stringify(input.category)}`);
  }
  assertNonNegativeInteger(input.count, "alert.count");

  const event = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: input.id === undefined ? idGenerator() : input.id,
    type: "alert",
    category: input.category,
    count: input.count,
    createdAt: input.createdAt === undefined ? clock() : input.createdAt,
  };
  assertNonEmptyString(event.id, "event.id");
  if (input.window !== undefined) {
    assertNonEmptyString(input.window, "alert.window");
    event.window = input.window;
  }
  if (input.severity !== undefined) {
    assertNonEmptyString(input.severity, "alert.severity");
    event.severity = input.severity;
  }
  return sanitizeEvent(event);
}

/**
 * Barrido final anti-PII/canario sobre un string ya saneado. Devuelve los ids
 * de patrones encontrados (canarios del redactor + PII de este módulo).
 */
function sweep(text) {
  if (typeof text !== "string") return [];
  const hits = [...redactor.findCanaries(text)];
  for (const { id, re } of PII_PATTERNS) {
    if (re.test(text)) hits.push(id);
  }
  return hits;
}

/**
 * Sanea un evento completo (fail-closed):
 *  1. Redacta por campo con el redactor del core (secretos, tokens, etc.).
 *  2. Aplica stripping explícito de rutas absolutas y repo URLs a cada string.
 *  3. Serializa y ejecuta el barrido anti-canario/PII. Si algo sobrevive, lanza
 *     y NO devuelve el evento, de modo que jamás se publique un valor sensible.
 *
 * @returns {object} evento saneado (congelado).
 */
function sanitizeEvent(event) {
  // Paso 1: redacción por campo (copia, no muta la entrada).
  const redacted = redactor.redact(event);
  // Paso 2: stripping explícito recursivo de rutas/URLs de repo.
  const stripped = deepStrip(redacted);
  // Paso 3: barrido final sobre el JSON serializado.
  const json = JSON.stringify(stripped);
  const hits = sweep(json);
  if (hits.length > 0) {
    const err = new Error(
      `evento de telemetría no apto para publicar: patrón(es) sensibles tras saneado: ${hits.join(", ")}`
    );
    err.code = "TELEMETRY_UNSAFE_EVENT";
    err.hits = hits;
    throw err;
  }
  return Object.freeze(stripped);
}

/** Aplica `stripSensitiveText` recursivamente a todos los strings. */
function deepStrip(value) {
  if (typeof value === "string") return stripSensitiveText(value);
  if (Array.isArray(value)) return value.map((v) => deepStrip(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepStrip(v);
    return out;
  }
  return value;
}

module.exports = {
  EVENT_SCHEMA_VERSION,
  RESULT_CATEGORIES,
  ERROR_CATEGORIES,
  EVENT_TYPES,
  ALERT_CATEGORIES,
  PII_PATTERNS,
  STRIPPED,
  buildControlEvent,
  buildAlertEvent,
  buildDimensions,
  normalizeAggregateScope,
  sanitizeEvent,
  sweep,
  stripSensitiveText,
};
