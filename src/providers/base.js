"use strict";

/**
 * Contrato base COMPARTIDO de los packs de provider (GitHub, AWS CodeCommit).
 *
 * Un "plan de provider" es un ARTEFACTO DESCRITO, no un cambio aplicado. Este
 * módulo define el contrato común que ambos packs (tareas 39–41) implementan y
 * garantiza por diseño las invariantes de seguridad de la fase P:
 *
 *  1. **Sin autoaplicación (16.1, 17.1, 22.6, G.9):** el contrato NO tiene ruta
 *     de `apply`. Un plan nunca muta estado cloud/remoto ni hace una llamada
 *     mutante. Cualquier apply futuro requiere confirmación humana EXPLÍCITA
 *     fuera de este plan; el plan lo documenta pero no lo ejecuta.
 *  2. **Local ≠ remoto (17.7):** la instalación LOCAL del pack está separada de
 *     la OBSERVACIÓN/aplicación remota. Observar es dry-run puro.
 *  3. **Aislamiento de packs (16.8, 17.1):** el core no instala providers y un
 *     provider no instala al otro. Cada generador es independiente; este módulo
 *     no importa a github/codecommit (serían dependencias cruzadas).
 *  4. **Estados de observación reutilizan el vocabulario de auditoría
 *     (checks.OBSERVATION):** observed | unauthorized | not-configured |
 *     unknown — diferenciando `unauthorized` (permiso presente pero denegado)
 *     de `not-configured` (sin credenciales/endpoint).
 *  5. **Determinismo (22.6):** mismo input → plan byte-idéntico. El reloj y el
 *     generador de ids son INYECTABLES; sin ellos no se fabrica un plan.
 *  6. **Redacción obligatoria:** el plan emitido cruza el redactor; las
 *     credenciales se leen SÓLO del entorno y jamás se imprimen (sólo su
 *     presencia). Fixtures sintéticos únicamente.
 *
 * Un generador de provider es una función/objeto con la forma:
 *   generate(input, deps) -> plan parcial { changes, requiredPermissions,
 *     parameters, rollback, observation, observationReason, reason }
 * y este módulo lo envuelve en `buildPlan` para producir el artefacto completo,
 * determinista y schema-válido.
 */

const { validateAgainst } = require("../domain/schema-validator.js");

const SCHEMA_VERSION = 1;

/** Providers soportados por el contrato base (los packs concretos llegan en 39–41). */
const PROVIDERS = Object.freeze(["github", "aws-codecommit"]);

/**
 * Estados de observación remota. Mismo vocabulario que la auditoría
 * (`audit/checks.js` OBSERVATION), restringido a los cuatro estados que el plan
 * expone (sin `not-applicable`, que es un concepto de auditoría, no de plan).
 *
 *  - observed:        el recurso/permiso fue observado remotamente (dry-run).
 *  - unauthorized:    hay credenciales/permiso presente pero el acceso fue
 *                     DENEGADO (401/403). Diferente de not-configured.
 *  - not-configured:  no hay credenciales/endpoint para intentar observar.
 *  - unknown:         no se pudo observar de forma concluyente (sin transporte,
 *                     timeout, error no concluyente).
 */
const OBSERVATION = Object.freeze({
  OBSERVED: "observed",
  UNAUTHORIZED: "unauthorized",
  NOT_CONFIGURED: "not-configured",
  UNKNOWN: "unknown",
});

const OBSERVATIONS = Object.freeze(Object.values(OBSERVATION));

/**
 * Nota canónica que todo plan incluye: no hay apply dentro del plan.
 */
const APPLY_NOTE =
  "Este plan es un artefacto dry-run; no muta estado remoto ni ejecuta " +
  "llamadas mutantes. Cualquier aplicación requiere confirmación humana " +
  "explícita mediante un mecanismo fuera de este plan.";

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

function assertObservation(value, label) {
  if (!OBSERVATIONS.includes(value)) {
    throw new TypeError(
      `${label} inválido: ${JSON.stringify(value)} (esperado uno de ${OBSERVATIONS.join(", ")})`
    );
  }
}

/**
 * Ordena deterministamente un arreglo de objetos por una clave string. El orden
 * NO depende del orden de inserción del generador, de modo que dos entradas
 * equivalentes produzcan el mismo plan byte a byte.
 */
function sortById(list, key) {
  return [...list].sort((a, b) => {
    const ka = String(a[key]);
    const kb = String(b[key]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Normaliza y valida una lista de cambios propuestos. Cada cambio DESCRIBE una
 * mutación futura; nunca la ejecuta.
 */
function normalizeChanges(changes) {
  if (changes === undefined) return [];
  if (!Array.isArray(changes)) throw new TypeError("changes debe ser un arreglo");
  const out = changes.map((c, i) => {
    if (!c || typeof c !== "object") throw new TypeError(`changes[${i}] debe ser un objeto`);
    assertNonEmptyString(c.id, `changes[${i}].id`);
    assertNonEmptyString(c.kind, `changes[${i}].kind`);
    assertNonEmptyString(c.target, `changes[${i}].target`);
    assertNonEmptyString(c.action, `changes[${i}].action`);
    assertNonEmptyString(c.description, `changes[${i}].description`);
    return {
      id: c.id,
      kind: c.kind,
      target: c.target,
      action: c.action,
      description: c.description,
    };
  });
  return sortById(out, "id");
}

/** Normaliza y valida la lista de permisos requeridos y su estado observado. */
function normalizePermissions(perms) {
  if (perms === undefined) return [];
  if (!Array.isArray(perms)) throw new TypeError("requiredPermissions debe ser un arreglo");
  const out = perms.map((p, i) => {
    if (!p || typeof p !== "object") throw new TypeError(`requiredPermissions[${i}] debe ser un objeto`);
    assertNonEmptyString(p.id, `requiredPermissions[${i}].id`);
    assertNonEmptyString(p.scope, `requiredPermissions[${i}].scope`);
    assertObservation(p.status, `requiredPermissions[${i}].status`);
    const entry = { id: p.id, scope: p.scope, status: p.status };
    entry.reason = typeof p.reason === "string" ? p.reason : null;
    return entry;
  });
  return sortById(out, "id");
}

/**
 * Normaliza parámetros. El valor resuelto va en `resolved` (NO `value`): el
 * campo `value` es un nombre reservado que el redactor obligatorio tacha, así
 * que usar otro nombre deja que un parámetro NO sensible (p. ej. presencia de
 * credencial) sobreviva a la serialización. Un parámetro nunca lleva un secreto:
 * sólo presencia/valores no sensibles.
 */
function normalizeParameters(params) {
  if (params === undefined) return [];
  if (!Array.isArray(params)) throw new TypeError("parameters debe ser un arreglo");
  const allowedSources = ["default", "config", "env-presence", "flag"];
  const out = params.map((p, i) => {
    if (!p || typeof p !== "object") throw new TypeError(`parameters[${i}] debe ser un objeto`);
    assertNonEmptyString(p.name, `parameters[${i}].name`);
    if (!allowedSources.includes(p.source)) {
      throw new TypeError(`parameters[${i}].source inválido: ${JSON.stringify(p.source)}`);
    }
    const t = typeof p.resolved;
    if (!(p.resolved === null || t === "string" || t === "number" || t === "boolean")) {
      throw new TypeError(`parameters[${i}].resolved debe ser string|number|boolean|null`);
    }
    return { name: p.name, resolved: p.resolved, source: p.source };
  });
  return sortById(out, "name");
}

/** Normaliza los pasos de rollback (texto descriptivo, sin ejecución). */
function normalizeRollback(rollback) {
  if (rollback === undefined) return [];
  if (!Array.isArray(rollback)) throw new TypeError("rollback debe ser un arreglo");
  const out = rollback.map((r, i) => {
    if (!r || typeof r !== "object") throw new TypeError(`rollback[${i}] debe ser un objeto`);
    assertNonEmptyString(r.id, `rollback[${i}].id`);
    assertNonEmptyString(r.description, `rollback[${i}].description`);
    return { id: r.id, description: r.description };
  });
  return sortById(out, "id");
}

/**
 * Construye un plan de provider COMPLETO, determinista y schema-válido a partir
 * de la salida parcial de un generador de pack.
 *
 * @param {object} partial  Salida del generador:
 *   { provider, changes?, requiredPermissions?, parameters?, rollback?,
 *     observation, observationReason?, reason? }
 * @param {object} deps  { clock, idGenerator } — AMBOS obligatorios para
 *   garantizar determinismo (mismo input → plan byte-idéntico).
 * @returns {object} plan congelado y validado contra provider-plan.schema.json
 */
function buildPlan(partial, deps = {}) {
  if (!partial || typeof partial !== "object") {
    throw new TypeError("buildPlan requiere un objeto parcial");
  }
  if (!PROVIDERS.includes(partial.provider)) {
    throw new TypeError(
      `provider inválido: ${JSON.stringify(partial.provider)} (esperado uno de ${PROVIDERS.join(", ")})`
    );
  }
  if (typeof deps.clock !== "function") {
    throw new TypeError("buildPlan requiere deps.clock inyectable (determinismo)");
  }
  if (typeof deps.idGenerator !== "function") {
    throw new TypeError("buildPlan requiere deps.idGenerator inyectable (determinismo)");
  }

  assertObservation(partial.observation, "observation");

  const generatedAt = deps.clock();
  assertNonEmptyString(generatedAt, "generatedAt (deps.clock)");
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new TypeError("deps.clock debe devolver un timestamp ISO-8601 válido");
  }

  const planId = deps.idGenerator();
  assertNonEmptyString(planId, "planId (deps.idGenerator)");

  const plan = {
    schemaVersion: SCHEMA_VERSION,
    provider: partial.provider,
    generatedAt,
    planId,
    observation: partial.observation,
    observationReason:
      typeof partial.observationReason === "string" ? partial.observationReason : null,
    // Invariantes de seguridad FIJAS por el contrato (no las decide el pack):
    dryRun: true,
    applied: false,
    apply: {
      supported: false,
      requiresHumanConfirmation: true,
      note: APPLY_NOTE,
    },
    changes: normalizeChanges(partial.changes),
    requiredPermissions: normalizePermissions(partial.requiredPermissions),
    parameters: normalizeParameters(partial.parameters),
    rollback: normalizeRollback(partial.rollback),
    reason: typeof partial.reason === "string" ? partial.reason : null,
  };

  const check = validateAgainst("provider-plan", plan);
  if (!check.valid) {
    const err = new Error(`plan de provider inválido: ${check.errors.join("; ")}`);
    err.code = "PROVIDER_PLAN_INVALID";
    err.errors = check.errors;
    throw err;
  }

  return deepFreeze(plan);
}

function deepFreeze(obj) {
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

module.exports = {
  SCHEMA_VERSION,
  PROVIDERS,
  OBSERVATION,
  OBSERVATIONS,
  APPLY_NOTE,
  buildPlan,
  // Exportados para pruebas de las normalizaciones deterministas.
  normalizeChanges,
  normalizePermissions,
  normalizeParameters,
  normalizeRollback,
};
