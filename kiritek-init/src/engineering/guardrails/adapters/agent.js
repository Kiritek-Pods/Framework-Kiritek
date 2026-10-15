"use strict";

/**
 * Lógica común de superficies de agente (T14.1).
 *
 * - Feedback temprano y rápido: momento `agent` (sólo checks locales; los
 *   harness se difieren a PR/release).
 * - No bloquea escrituras parciales: una escritura del agente puede dejar
 *   incompleto un artefacto que se completa en el mismo cambio (contrato,
 *   manifest, señal). Findings de esa clase nunca bloquean en `agent`, aunque
 *   un catálogo futuro habilitara enforcement en ese momento.
 * - Sólo un deny ELEGIBLE del core (report.outcome.policyDeny) puede bloquear;
 *   el adaptador no eleva heurísticas ni errores operativos.
 */

/** Reglas "completables en el mismo cambio" (sufijo de ruleId). */
const COMPLETABLE_RULES = Object.freeze([
  "required-signal-missing",
  "metadata-invalid",
  "contract-invalid",
  "launch-confirmation",
  "policy-evidence-missing",
  "evidence-missing",
]);

const ruleSuffix = (ruleId) => String(ruleId || "").split("/").pop();

/**
 * Decisión central para una superficie de agente.
 * @returns {{decision:"allow"|"warn"|"deny", blocking:boolean, messages:string[], blockingResults:object[]}}
 */
function agentDecision(report) {
  const messages = [];
  const blocking = [];
  for (const e of report.results) {
    if (!e.result) continue;
    const label = `${e.control.id} @ ${e.unit.id}`;
    if (e.result.decision === "deny" && e.blockingEligible) {
      const active = e.result.findings.filter((f) => f.status !== "suppressed" && !COMPLETABLE_RULES.includes(ruleSuffix(f.ruleId)));
      if (active.length) {
        blocking.push({ unitId: e.unit.id, controlId: e.control.id, rules: [...new Set(active.map((f) => ruleSuffix(f.ruleId)))].sort() });
        messages.push(`${label}: deny — ${blocking[blocking.length - 1].rules.join(", ")}`);
        continue;
      }
      messages.push(`${label}: pendiente de completar en este cambio (no bloquea en agent)`);
      continue;
    }
    if (e.result.decision === "warn" || e.result.decision === "error") messages.push(`${label}: ${e.result.decision}${e.result.reason ? ` — ${e.result.reason}` : ""}`);
  }
  const deny = report.moment !== "agent" ? report.outcome.policyDeny : report.outcome.policyDeny && blocking.length > 0;
  const warned = messages.length > 0;
  return { decision: deny ? "deny" : warned ? "warn" : "allow", blocking: deny, messages, blockingResults: deny ? blocking : [] };
}

module.exports = { COMPLETABLE_RULES, agentDecision };
