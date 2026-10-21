"use strict";

/**
 * Contrato de entrada de política (`PolicyInput`) del core de seguridad.
 *
 * Es la representación normalizada de un evento que cualquier adaptador
 * (hooks Git, Claude, Kiro, CI) produce para que el motor de políticas decida.
 * El motor es puro: recibe un `PolicyInput` y devuelve un `PolicyResult`
 * (ver result.js). Este contrato NO transporta valores sensibles.
 */

const { assertNoForbiddenFields } = require("./result.js");

const SCHEMA_VERSION = 1;

const EVENTS = Object.freeze([
  "pre-commit",
  "pre-push",
  "commit-msg",
  "tool-write",
  "tool-command",
  "ci-scan",
  "audit",
]);

const MODES = Object.freeze(["warning", "enforce"]);

const ACTOR_TYPES = Object.freeze(["human", "claude", "kiro", "ci", "unknown"]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} inválido: ${JSON.stringify(value)} (esperado uno de ${allowed.join(", ")})`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new TypeError(`${label} debe ser un arreglo de strings`);
  }
}

/**
 * Normaliza y valida un `PolicyInput`.
 *
 * @param {object} input
 * @param {string} input.event         Uno de EVENTS.
 * @param {string} input.mode          Uno de MODES.
 * @param {string} input.repositoryRoot Raíz absoluta del repositorio.
 * @param {string} [input.actorType]   Uno de ACTOR_TYPES (default unknown).
 * @param {string} [input.command]     Comando propuesto (sin evaluarse como shell).
 * @param {string[]} [input.paths]     Rutas afectadas (relativas al repo).
 * @param {string} [input.scope]       Alcance (p. ej. commit/rango).
 * @param {string} [input.defaultBranch] Rama default resuelta.
 */
function createPolicyInput(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("createPolicyInput requiere un objeto");
  }
  assertNoForbiddenFields(input, "createPolicyInput");

  assertEnum(input.event, EVENTS, "policyInput.event");
  assertEnum(input.mode, MODES, "policyInput.mode");
  assertNonEmptyString(input.repositoryRoot, "policyInput.repositoryRoot");

  const actorType = input.actorType === undefined ? "unknown" : input.actorType;
  assertEnum(actorType, ACTOR_TYPES, "policyInput.actorType");

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    event: input.event,
    mode: input.mode,
    repositoryRoot: input.repositoryRoot,
    actorType,
  };

  if (input.command !== undefined) {
    assertNonEmptyString(input.command, "policyInput.command");
    normalized.command = input.command;
  }
  if (input.paths !== undefined) {
    assertStringArray(input.paths, "policyInput.paths");
    normalized.paths = Object.freeze([...input.paths]);
  }
  if (input.scope !== undefined) {
    assertNonEmptyString(input.scope, "policyInput.scope");
    normalized.scope = input.scope;
  }
  if (input.defaultBranch !== undefined) {
    assertNonEmptyString(input.defaultBranch, "policyInput.defaultBranch");
    normalized.defaultBranch = input.defaultBranch;
  }

  return Object.freeze(normalized);
}

module.exports = {
  SCHEMA_VERSION,
  EVENTS,
  MODES,
  ACTOR_TYPES,
  createPolicyInput,
};
