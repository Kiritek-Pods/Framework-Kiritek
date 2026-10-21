"use strict";

/**
 * Compuerta de confianza y agregación (T06.5, T06.6, T06.8).
 *
 * - `mayDeny` se recalcula SIEMPRE en el core (`denyEligibilityViolations`
 *   del contrato, que incluye momento y completitud de la evidencia).
 *   Lo que diga el evaluator o un plugin no cuenta.
 * - Un `deny` no elegible se degrada a `warn` (evaluado) o `error` (estado
 *   operativo/conflicto) con diagnóstico `DENY_NOT_ELIGIBLE` y evento
 *   auditable.
 * - La agregación conserva cada resultado (unidad/control/dominio) y separa
 *   `policyDeny` de `operationalError`: un error nunca se presenta como
 *   incumplimiento.
 */

const { createResultEnvelope, denyEligibilityViolations, EVALUATION_STATE } = require("../contracts/result-envelope.js");
const { DECISION } = require("../contracts/policy-result.js");
const { PACK_ID, DOMAIN, deepFreeze, FRESHNESS } = require("../contracts/common.js");

/** Evalúa el predicado sobre un borrador sin construir el envelope. */
function draftViolations(draft) {
  return denyEligibilityViolations({ ...draft, suppressed: draft.suppressed || [], findingEvidence: draft.findingEvidence || [] });
}

/**
 * @param {object} draft  Entrada de `createResultEnvelope` (sin blockingEligible).
 * @returns {{envelope, events: object[]}}
 */
function enforceTrustGate(draft) {
  const events = [];
  let input = draft;
  if (draft.result && draft.result.decision === DECISION.DENY) {
    const violations = draftViolations(draft);
    if (violations.length) {
      const operational =
        draft.state !== EVALUATION_STATE.EVALUATED || draft.evidenceFreshness === FRESHNESS.CONFLICT;
      const decision = operational ? DECISION.ERROR : DECISION.WARN;
      input = {
        ...draft,
        result: { ...draft.result, decision, reason: `DENY_NOT_ELIGIBLE: ${violations.join("; ")}` },
        diagnostics: [
          ...draft.diagnostics,
          { code: "DENY_NOT_ELIGIBLE", stage: "trust-gate", message: `deny degradado a ${decision}: ${violations.join("; ")}` },
        ],
      };
      events.push({ type: "deny-not-eligible", unitId: draft.unit.id, controlId: draft.control.id, degradedTo: decision, violations });
    }
  }
  return { envelope: createResultEnvelope(input), events };
}

function compareEnvelopes(a, b) {
  const ka = `${a.unit.id}|${a.control.id}`;
  const kb = `${b.unit.id}|${b.control.id}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Reporte engineering de una ejecución. No hay booleano global de
 * "conformidad"; `outcome` separa deny de política y error operativo.
 */
function aggregateRun({ moment, catalog, configHash, revision, envelopes, events = [], diagnostics = [], exceptions }) {
  const results = [...envelopes].sort(compareEnvelopes);
  const byState = {};
  const byDecision = {};
  for (const e of results) {
    byState[e.state] = (byState[e.state] || 0) + 1;
    const d = e.result ? e.result.decision : "none";
    byDecision[d] = (byDecision[d] || 0) + 1;
  }
  const policyDeny = results.some((e) => e.result && e.result.decision === DECISION.DENY && e.blockingEligible);
  const operationalError = results.some((e) => e.result && e.result.decision === DECISION.ERROR);
  const warned = results.some((e) => e.result && e.result.decision === DECISION.WARN);
  const decision = policyDeny ? "deny" : operationalError ? "error" : warned ? "warn" : "allow";
  return deepFreeze({
    schemaVersion: 1,
    domain: DOMAIN.ENGINEERING,
    packId: PACK_ID,
    moment,
    catalog,
    configHash,
    revision,
    results,
    summary: { total: results.length, byState, byDecision },
    outcome: {
      decision,
      policyDeny,
      operationalError,
      blockingResults: results.filter((e) => e.blockingEligible && e.result && e.result.decision === DECISION.DENY).map((e) => ({ unitId: e.unit.id, controlId: e.control.id })),
      exitCodeHint: policyDeny ? 1 : operationalError ? 3 : 0,
    },
    ...(exceptions ? { exceptions } : {}),
    events,
    diagnostics,
  });
}

module.exports = { enforceTrustGate, aggregateRun, draftViolations };
