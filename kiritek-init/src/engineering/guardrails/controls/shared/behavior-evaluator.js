"use strict";

/**
 * Evaluator común (puro) de los controles con contrato + harness (T18–T21).
 *
 * Evidencia determinista: contrato inválido, reglas semánticas del contrato
 * incumplidas y escenarios conductuales cuyo paso observado no cumple la
 * expectativa derivada del contrato. Sin contrato ⇒ warn heurístico. Faltar
 * tests no es incumplimiento: sólo avisa. Cada control aporta su spec.
 */

const { isFastMoment, deferredReason } = require("./moments.js");

/** Hechos discrepantes entre un paso y su expectativa (literal, lista permitida o predicado). */
function mismatches(step, exp) {
  if (!step) return ["missing"];
  const bad = [];
  for (const [k, want] of Object.entries(exp)) {
    const ok = typeof want === "function" ? want(step[k], step) : Array.isArray(want) ? want.includes(step[k]) : step[k] === want;
    if (!ok) bad.push(k);
  }
  return bad;
}

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {object} spec
 * @param {string} spec.control, spec.prefix, spec.paramName
 * @param {string} spec.contractKind, spec.behaviorKind, spec.signalsKind
 * @param {object} spec.remediation, [spec.severity]
 * @param {string} spec.heuristicRule, spec.heuristicRemediation, spec.missingContractReason, spec.heuristicReason
 * @param {(facts, params, nowIso) => {rule, subject}[]} spec.contractFindings
 * @param {(facts, params) => string[]} spec.requiredScenarios   [] ⇒ el contrato no pide tests
 * @param {(scenarioId, harnessParams) => object[]} spec.expectationsFor
 * @param {(scenarioId, fact) => string} spec.ruleFor
 * @param {(facts, params, nowIso) => string|undefined} [spec.allowReason]
 */
function makeEvaluator(spec) {
  const severity = spec.severity || {};
  const finding = (rule, ref, path, subject) => ({
    ruleId: `${spec.control}/${rule}`,
    path,
    severity: severity[rule] || "medium",
    fingerprint: `${spec.prefix}:${rule}${subject ? `:${subject}` : ""}`,
    remediation: spec.remediation[rule],
    evidenceClass: "deterministic",
    observationRefs: [ref],
  });

  function evaluate(input) {
    const params = input.effectiveConfig;
    const obs = input.observations;
    const contractObs = obs.find((o) => o.kind === spec.contractKind);
    const contractPath = params[spec.paramName] || input.unit.root;

    if (!contractObs || !contractObs.facts.declared) {
      const signals = obs.find((o) => o.kind === spec.signalsKind);
      const findings = ((signals && signals.facts.signals) || []).map((s) => ({
        ruleId: `${spec.control}/${spec.heuristicRule}`,
        path: s.path,
        severity: "low",
        fingerprint: `${spec.prefix}:signal:${s.path}`,
        remediation: spec.heuristicRemediation,
        evidenceClass: "heuristic",
      }));
      return { decision: "warn", reason: findings.length ? spec.heuristicReason : spec.missingContractReason, ...(findings.length ? { findings } : {}) };
    }

    if (!contractObs.facts.valid) {
      const codes = contractObs.facts.errorCodes;
      return { decision: "deny", reason: `Contrato inválido (${codes.join(", ")}).`, findings: [finding("contract-invalid", contractObs.observationId, contractPath, codes.join("-").toLowerCase())] };
    }
    const facts = contractObs.facts.contract;
    const findings = [];
    const seen = new Set();
    const add = (rule, ref, subject) => {
      const key = `${rule}|${subject || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(finding(rule, ref, contractPath, subject));
    };
    for (const { rule, subject } of spec.contractFindings(facts, params, input.clockRef)) add(rule, contractObs.observationId, subject);

    const behavior = obs.filter((o) => o.kind === spec.behaviorKind).sort((a, b) => byId(a.facts.scenario, b.facts.scenario));
    for (const o of behavior) {
      const id = o.facts.scenario;
      const expected = spec.expectationsFor(id, o.facts.params);
      const rules = new Set();
      expected.forEach((exp, i) => mismatches(o.facts.steps[i], exp).forEach((fact) => rules.add(spec.ruleFor(id, fact))));
      for (const rule of [...rules].sort()) add(rule, o.observationId, id);
    }

    const required = spec.requiredScenarios(facts, params);
    const present = new Set(behavior.map((o) => o.facts.scenario));
    const missing = required.filter((s) => !present.has(s));
    if (findings.length) {
      const rules = [...new Set(findings.map((f) => f.ruleId.split("/")[1]))].join(", ");
      return { decision: "deny", reason: `Incumplimientos deterministas: ${rules}.${missing.length ? ` Escenarios sin evidencia: ${missing.length}.` : ""}`, findings };
    }
    if (missing.length && !present.size && facts.hasHarness && isFastMoment(input.event)) return { decision: "warn", reason: deferredReason(input.event) };
    if (missing.length) {
      const why = facts.hasHarness ? `faltan ${missing.length} escenarios (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""})` : "el contrato no declara harness";
      return { decision: "warn", reason: `Tests conductuales incompletos: ${why}.` };
    }
    const note = spec.allowReason ? spec.allowReason(facts, params, input.clockRef) : undefined;
    return { decision: "allow", ...(note ? { reason: note } : {}) };
  }

  return { version: spec.version || "1.0.0", evaluate };
}

module.exports = { makeEvaluator, mismatches };
