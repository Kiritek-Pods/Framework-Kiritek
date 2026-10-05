"use strict";

/**
 * Adaptación explícita de `src/domain/result.js` (PolicyResult v1) para el
 * dominio engineering.
 *
 * No modifica la semántica security: reutiliza `createResult` tal cual y sólo
 * añade restricciones del lado engineering (ID de control namespaceado,
 * campos prohibidos ampliados, validación contra `result.schema.json`). Los
 * estados que v1 no puede expresar (timeout, conflict, stale…) viven en el
 * envelope v2; aquí se proyectan a `toolStatus: unavailable` + razón.
 */

const result = require("../../../domain/result.js");
const { validateAgainst } = require("../../../domain/schema-validator.js");
const c = require("./common.js");

/** Construye un PolicyResult v1 válido para un control engineering. */
function createEngineeringPolicyResult(input) {
  c.assertObject(input, "policyResult");
  c.assertNoForbiddenFieldsDeep(input, "policyResult");
  c.assertControlId(input.controlId, "policyResult.controlId");
  return result.createResult(input);
}

/**
 * Revalida un PolicyResult v1 ya construido (p. ej. leído de JSON o emitido
 * por un plugin): schema v1 estricto + invariantes de `createResult`.
 */
function parsePolicyResultV1(value) {
  c.assertObject(value, "policyResult");
  const check = validateAgainst("result", value);
  if (!check.valid) c.fail(`PolicyResult v1 inválido: ${check.errors.join("; ")}`, "RESULT_SCHEMA");
  const { schemaVersion, ...rest } = value;
  return createEngineeringPolicyResult({ ...rest, findings: value.findings.map((f) => ({ ...f })) });
}

/**
 * Proyecta un estado operativo del envelope a un payload v1 `error`.
 * Nunca produce `allow` ni `deny`.
 */
function operationalResult(controlId, state, reason) {
  return createEngineeringPolicyResult({
    controlId,
    decision: result.DECISION.ERROR,
    toolStatus: result.TOOL_STATUS.UNAVAILABLE,
    reason: `${state}: ${reason}`,
  });
}

module.exports = {
  DECISION: result.DECISION,
  SEVERITY: result.SEVERITY,
  TOOL_STATUS: result.TOOL_STATUS,
  FINDING_STATUS: result.FINDING_STATUS,
  createEngineeringPolicyResult,
  parsePolicyResultV1,
  operationalResult,
};
