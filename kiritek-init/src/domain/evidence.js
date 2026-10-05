"use strict";

/**
 * Contrato de evidencia del core de seguridad Kiritek.
 *
 * Una `Evidence` respalda una afirmación de verificación (requisito 11): sin
 * evidencia vigente y del mismo alcance, un estado no puede declararse
 * `verified`. La evidencia NO contiene código, prompts ni valores sensibles;
 * sólo metadatos reproducibles (comando, versión, hash de config, alcance,
 * exit code, decisión, referencia al reporte redactado).
 *
 * `clock` e `idGenerator` son inyectables para que las pruebas sean
 * deterministas.
 */

const { assertNoForbiddenFields } = require("./result.js");

const SCHEMA_VERSION = 1;

const VERIFIED_STATES = Object.freeze(["verified", "tested", "working", "cumple"]);
const UNVERIFIED_STATES = Object.freeze([
  "not_executed",
  "unverified",
  "partial",
  "warning",
  "failed",
]);
const ALL_STATES = Object.freeze([...VERIFIED_STATES, ...UNVERIFIED_STATES]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

function assertInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} debe ser un entero`);
  }
}

function assertIsoTimestamp(value, label) {
  assertNonEmptyString(value, label);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`${label} debe ser un timestamp ISO-8601 válido`);
  }
}

const defaultClock = () => new Date().toISOString();
let evidenceCounter = 0;
const defaultIdGenerator = () => {
  evidenceCounter += 1;
  return `ev-${Date.now().toString(36)}-${evidenceCounter.toString(36)}`;
};

/**
 * Crea una evidencia validada.
 *
 * @param {object} input
 * @param {string} input.control        Control/comando que generó la evidencia.
 * @param {string} input.command        Comando reproducible ejecutado.
 * @param {string} input.toolVersion    Versión efectiva de la herramienta.
 * @param {string} input.configHash     Hash de la configuración usada.
 * @param {string} input.scope          Alcance evaluado (p. ej. commit/rango).
 * @param {number} input.exitCode       Exit code del comando.
 * @param {string} input.decision       Decisión asociada (allow/warn/deny/error).
 * @param {string} [input.reportRef]    Referencia al reporte redactado.
 * @param {string} [input.commit]       Commit al que corresponde la evidencia.
 * @param {object} [deps]
 * @param {() => string} [deps.clock]       Fuente de timestamp ISO.
 * @param {() => string} [deps.idGenerator] Fuente de id único.
 */
function createEvidence(input, deps = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("createEvidence requiere un objeto");
  }
  assertNoForbiddenFields(input, "createEvidence");

  const clock = deps.clock || defaultClock;
  const idGenerator = deps.idGenerator || defaultIdGenerator;

  assertNonEmptyString(input.control, "evidence.control");
  assertNonEmptyString(input.command, "evidence.command");
  assertNonEmptyString(input.toolVersion, "evidence.toolVersion");
  assertNonEmptyString(input.configHash, "evidence.configHash");
  assertNonEmptyString(input.scope, "evidence.scope");
  assertInteger(input.exitCode, "evidence.exitCode");
  assertNonEmptyString(input.decision, "evidence.decision");

  const createdAt = input.createdAt === undefined ? clock() : input.createdAt;
  assertIsoTimestamp(createdAt, "evidence.createdAt");

  const id = input.id === undefined ? idGenerator() : input.id;
  assertNonEmptyString(id, "evidence.id");

  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    id,
    control: input.control,
    command: input.command,
    toolVersion: input.toolVersion,
    configHash: input.configHash,
    scope: input.scope,
    exitCode: input.exitCode,
    decision: input.decision,
    createdAt,
  };
  if (input.reportRef !== undefined) {
    assertNonEmptyString(input.reportRef, "evidence.reportRef");
    evidence.reportRef = input.reportRef;
  }
  if (input.commit !== undefined) {
    assertNonEmptyString(input.commit, "evidence.commit");
    evidence.commit = input.commit;
  }

  return Object.freeze(evidence);
}

/**
 * ¿La evidencia sostiene una afirmación `verified` para un alcance/commit dado?
 *
 * Reglas (requisito 11.4):
 * - exitCode debe ser 0 (ejecución exitosa).
 * - No puede haber expirado respecto a `maxAgeHours`.
 * - Si se exige commit/alcance, deben coincidir con los de la evidencia.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
function supportsVerification(evidence, expectation = {}, deps = {}) {
  if (!evidence || typeof evidence !== "object") {
    return { ok: false, reason: "evidencia ausente" };
  }
  const now = deps.now ? deps.now() : Date.now();

  if (evidence.exitCode !== 0) {
    return { ok: false, reason: "la evidencia no corresponde a una ejecución exitosa" };
  }
  if (expectation.commit !== undefined && evidence.commit !== expectation.commit) {
    return { ok: false, reason: "la evidencia corresponde a otro commit" };
  }
  if (expectation.scope !== undefined && evidence.scope !== expectation.scope) {
    return { ok: false, reason: "la evidencia no cubre el alcance declarado" };
  }
  if (expectation.maxAgeHours !== undefined) {
    if (!(expectation.maxAgeHours > 0)) {
      throw new TypeError("expectation.maxAgeHours debe ser > 0");
    }
    const ageMs = now - Date.parse(evidence.createdAt);
    if (ageMs > expectation.maxAgeHours * 3600 * 1000) {
      return { ok: false, reason: "la evidencia ha expirado" };
    }
  }
  return { ok: true };
}

module.exports = {
  SCHEMA_VERSION,
  VERIFIED_STATES,
  UNVERIFIED_STATES,
  ALL_STATES,
  createEvidence,
  supportsVerification,
};
