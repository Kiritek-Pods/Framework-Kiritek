"use strict";

/**
 * Contrato de excepciones gobernadas (requisito 28).
 *
 * Una excepción permite tolerar un hallazgo o relajar un control de forma
 * controlada, nunca permanente. Debe tener control afectado, fingerprint/ruta
 * mínima, razón, propietario, ticket, creación y expiración. No existe la
 * excepción "global silenciosa", ni `--no-verify` como mecanismo válido.
 *
 * `clock` es inyectable para pruebas deterministas.
 */

const { assertNoForbiddenFields } = require("./result.js");

const SCHEMA_VERSION = 1;

/** Tope defensivo: una excepción no puede durar indefinidamente. */
const MAX_EXPIRY_DAYS = 180;

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

function assertIsoTimestamp(value, label) {
  assertNonEmptyString(value, label);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} debe ser un timestamp ISO-8601 válido`);
  }
}

const defaultClock = () => new Date().toISOString();

/**
 * Crea una excepción validada.
 *
 * Reglas:
 * - `scopeFingerprint` o `scopePath` es obligatorio: no se aceptan excepciones
 *   sin un objetivo mínimo (28.1, 28.3).
 * - `expiresAt` es obligatorio, futuro y dentro de MAX_EXPIRY_DAYS (28.3).
 *
 * @param {object} input
 * @param {string} input.controlId        Control afectado.
 * @param {string} [input.scopeFingerprint] Huella del hallazgo tolerado.
 * @param {string} [input.scopePath]      Ruta mínima afectada.
 * @param {string} input.reason           Razón de la excepción.
 * @param {string} input.owner            Propietario responsable.
 * @param {string} input.ticket           Ticket/incidente de respaldo.
 * @param {string} input.expiresAt        Expiración ISO.
 * @param {string} [input.approver]       Aprobador (distinto del autor).
 * @param {string} [input.createdAt]      Creación ISO (default: clock).
 * @param {object} [deps]
 * @param {() => string} [deps.clock]
 */
function createException(input, deps = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("createException requiere un objeto");
  }
  assertNoForbiddenFields(input, "createException");

  const clock = deps.clock || defaultClock;

  assertNonEmptyString(input.controlId, "exception.controlId");
  assertNonEmptyString(input.reason, "exception.reason");
  assertNonEmptyString(input.owner, "exception.owner");
  assertNonEmptyString(input.ticket, "exception.ticket");

  const hasFingerprint = typeof input.scopeFingerprint === "string" && input.scopeFingerprint.trim() !== "";
  const hasPath = typeof input.scopePath === "string" && input.scopePath.trim() !== "";
  if (!hasFingerprint && !hasPath) {
    throw new TypeError("exception requiere scopeFingerprint o scopePath — no se aceptan excepciones globales");
  }

  const createdAt = input.createdAt === undefined ? clock() : input.createdAt;
  assertIsoTimestamp(createdAt, "exception.createdAt");

  assertIsoTimestamp(input.expiresAt, "exception.expiresAt");
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(input.expiresAt);
  if (expiresMs <= createdMs) {
    throw new TypeError("exception.expiresAt debe ser posterior a createdAt");
  }
  const maxMs = createdMs + MAX_EXPIRY_DAYS * 24 * 3600 * 1000;
  if (expiresMs > maxMs) {
    throw new TypeError(`exception.expiresAt no puede exceder ${MAX_EXPIRY_DAYS} días desde createdAt`);
  }

  const exception = {
    schemaVersion: SCHEMA_VERSION,
    controlId: input.controlId,
    reason: input.reason,
    owner: input.owner,
    ticket: input.ticket,
    createdAt,
    expiresAt: input.expiresAt,
  };
  if (hasFingerprint) exception.scopeFingerprint = input.scopeFingerprint;
  if (hasPath) exception.scopePath = input.scopePath;
  if (input.approver !== undefined) {
    assertNonEmptyString(input.approver, "exception.approver");
    exception.approver = input.approver;
  }

  return Object.freeze(exception);
}

/**
 * ¿La excepción está vigente para un momento dado?
 * @returns {{ active: boolean, reason?: string }}
 */
function isActive(exception, deps = {}) {
  if (!exception || typeof exception !== "object") {
    return { active: false, reason: "excepción ausente" };
  }
  const now = deps.now ? deps.now() : Date.now();
  if (now >= Date.parse(exception.expiresAt)) {
    return { active: false, reason: "excepción expirada" };
  }
  return { active: true };
}

/**
 * ¿La excepción cubre un hallazgo? El fingerprint debe coincidir exactamente;
 * si cambia el fingerprint, la excepción deja de aplicar (28.4).
 */
function covers(exception, finding, deps = {}) {
  if (!isActive(exception, deps).active) return false;
  if (!finding || typeof finding !== "object") return false;
  if (exception.scopeFingerprint !== undefined) {
    return exception.scopeFingerprint === finding.fingerprint;
  }
  if (exception.scopePath !== undefined) {
    return exception.scopePath === finding.path;
  }
  return false;
}

module.exports = {
  SCHEMA_VERSION,
  MAX_EXPIRY_DAYS,
  createException,
  isActive,
  covers,
};
