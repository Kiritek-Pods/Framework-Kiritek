"use strict";

/**
 * Evaluator puro de `app.minimum-supported-version` (T11.1–T11.6).
 *
 * Dos fuentes de evidencia determinista (R10.12):
 *  1. Contrato de política: forma inválida o reglas semánticas incumplidas
 *     (fuente sin autenticidad, gracia con reloj local, rollback que exige
 *     publicar app, override no gobernado, observabilidad incompleta…).
 *  2. Harness conductual: cada decisión observada se compara con la esperada
 *     según el contrato (expectationsFor). Sin comparación lexicográfica.
 *
 * Sin contrato ⇒ warn (heurístico). Nunca se consulta la fuente remota real:
 * su indisponibilidad no produce findings.
 */

const { REQUIRED_SCENARIOS, expectationsFor, ruleFor } = require("./scenarios.js");
const { isFastMoment, deferredReason } = require("../shared/moments.js");

const VERSION = "1.0.0";
const CONTROL = "app.minimum-supported-version";
const REQUIRED_EVENTS = ["cache", "decision", "fetch", "override", "parse", "store"];
const MAX_OVERRIDE_HOURS = 168;

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de política (ruta, JSON y schema app-minimum-supported-version.contract).",
  "contract-source-authenticity": "Declare una fuente autenticable por entorno (firma con keyId, provider-auth o pinning); 'none' no es aceptable.",
  "contract-environments": "Declare la política para todos los entornos configurados en parameters.environments.",
  "contract-timeout": "El timeout de la fuente debe ser ≤ parameters.timeoutMs.",
  "contract-cache": "TTL y staleIfOffline del contrato no deben superar los máximos configurados.",
  "contract-offline": "La política de primera ejecución offline debe coincidir con parameters.firstRunOffline.",
  "contract-grace": "La gracia debe usar tiempo confiable (server o signed-timestamp) y una duración máxima declarada.",
  "contract-hard-exit": "El hard update debe explicar el motivo y ofrecer salida cuando el store no esté disponible (sin loops).",
  "contract-soft": "El soft update debe permitir continuar.",
  "contract-store-fallback": "Cada store/plataforma debe declarar un fallback alcanzable.",
  "contract-rollback": "La política debe poder revertirse sin publicar una nueva versión de la app (fuente remota, no bundled).",
  "contract-override": `El override de emergencia debe ser autenticado, auditado, reversible, acotado por entorno y ≤ ${MAX_OVERRIDE_HOURS} h.`,
  "contract-observability": "Observe fetch, parse, cache, decision, store y override sin identificadores en claro.",
  "version-comparison": "Compare versiones con semántica semver (prerelease < release, build metadata ignorada), nunca lexicográficamente.",
  "hard-flow": "El hard update debe impedir continuar, explicar el motivo de forma accesible y mantener la acción de actualización/salida.",
  "soft-flow": "El soft update debe permitir continuar y posponer según la frecuencia declarada.",
  "untrusted-payload": "Una política inválida o con firma inválida no debe aplicarse: siga la política de indisponibilidad declarada.",
  timeout: "La obtención de política debe terminar dentro del timeout declarado y seguir la política offline; nunca quedar colgada.",
  "offline-policy": "Aplique la política offline declarada para primera ejecución, cache válida y cache expirada.",
  grace: "La gracia debe convertir hard en soft mientras esté vigente según tiempo confiable, no el reloj local.",
  "store-fallback": "Con store ausente, ofrezca el fallback declarado y una salida; con distribución enterprise, use su canal.",
  rollback: "Revertir la política remota debe levantar el bloqueo sin publicar una nueva versión de la app.",
  override: "Sólo un override autenticado, vigente y del entorno correcto puede levantar el bloqueo.",
};
const SEVERITY = { "contract-invalid": "high", "version-comparison": "high", "hard-flow": "high", "untrusted-payload": "high", grace: "high", rollback: "high", override: "high" };

function contractFindings(c, params) {
  const v = [];
  if (c.environments.some((e) => e.authenticity === "none" || (e.authenticity === "signature" && !e.hasKeyId))) v.push("contract-source-authenticity");
  const names = c.environments.map((e) => e.name);
  if ((params.environments || []).some((e) => !names.includes(e))) v.push("contract-environments");
  if (c.environments.some((e) => e.timeoutMs > params.timeoutMs)) v.push("contract-timeout");
  if (params.cache && c.environments.some((e) => e.cacheTtlSeconds > params.cache.ttlSeconds || e.staleIfOfflineSeconds > params.cache.staleIfOfflineSeconds)) v.push("contract-cache");
  if (params.firstRunOffline && c.offline.firstRun !== params.firstRunOffline) v.push("contract-offline");
  if (c.grace.allowed && (!["server", "signed-timestamp"].includes(c.grace.timeSource) || !c.grace.maxDays)) v.push("contract-grace");
  if (!c.hard.explainReason || c.hard.exitWhenStoreUnavailable === "none") v.push("contract-hard-exit");
  if (!c.soft.allowContinue) v.push("contract-soft");
  if (c.stores.some((s) => s.fallback === "none" && s.platform !== "enterprise")) v.push("contract-store-fallback");
  if (c.rollback.requiresAppRelease || c.rollback.mechanism === "app-release" || c.environments.some((e) => e.sourceKind === "bundled")) v.push("contract-rollback");
  const o = c.override;
  if (!o.authenticated || !o.audited || !o.reversible || !o.scopedBy.includes("environment") || o.maxDurationHours > MAX_OVERRIDE_HOURS) v.push("contract-override");
  const ob = c.observability;
  if (ob.identifiers === "raw" || REQUIRED_EVENTS.some((e) => !ob.events.includes(e))) v.push("contract-observability");
  return v;
}

/** Campos discrepantes entre una decisión observada y su expectativa. */
function mismatches(decision, exp) {
  if (!decision) return ["missing"];
  if (!decision.settled) return ["settled"];
  const bad = [];
  for (const [k, want] of Object.entries(exp)) {
    if (k === "maxSettleMs") {
      if (decision.settledAt > want) bad.push("settledAt");
    } else if (Array.isArray(want)) {
      if (!want.includes(decision[k])) bad.push(k);
    } else if (decision[k] !== want) {
      bad.push(k);
    }
  }
  return bad;
}

function finding(rule, ref, path, fpSuffix) {
  return {
    ruleId: `${CONTROL}/${rule}`,
    path,
    severity: SEVERITY[rule] || "medium",
    fingerprint: `amsv:${rule}${fpSuffix ? `:${fpSuffix}` : ""}`,
    remediation: REMEDIATION[rule],
    evidenceClass: "deterministic",
    observationRefs: [ref],
  };
}

function evaluate(input) {
  const params = input.effectiveConfig;
  const obs = input.observations;
  const contractObs = obs.find((o) => o.kind === "version-contract");
  const contractPath = params.policyContract || input.unit.root;

  if (!contractObs || !contractObs.facts.declared) {
    const signals = obs.find((o) => o.kind === "version-signals");
    const findings = ((signals && signals.facts.signals) || []).map((s, i) => ({
      ruleId: `${CONTROL}/policy-evidence-missing`,
      path: s.path,
      severity: "low",
      fingerprint: `amsv:signal:${i}:${s.path}`,
      remediation: "Posible lógica de versión mínima sin contrato verificable. Declare policyContract y ejecute el harness; nombres o AST no prueban el comportamiento.",
      evidenceClass: "heuristic",
    }));
    return { decision: "warn", reason: "Falta el contrato de política de versión mínima: no hay evidencia verificable de fuente, offline, hard/soft, stores, rollback ni override.", ...(findings.length ? { findings } : {}) };
  }

  const findings = [];
  if (!contractObs.facts.valid) {
    findings.push(finding("contract-invalid", contractObs.observationId, contractPath, contractObs.facts.errorCodes.join("-").toLowerCase()));
    return { decision: "deny", reason: `Contrato de política inválido (${contractObs.facts.errorCodes.join(", ")}).`, findings };
  }
  for (const rule of contractFindings(contractObs.facts.contract, params)) findings.push(finding(rule, contractObs.observationId, contractPath));

  const behavior = obs.filter((o) => o.kind === "version-behavior").sort((a, b) => (a.facts.scenario < b.facts.scenario ? -1 : 1));
  for (const o of behavior) {
    const id = o.facts.scenario;
    const expected = expectationsFor(id, contractObs.facts.contract, o.facts.params);
    const rules = new Set();
    expected.forEach((exp, i) => {
      const bad = mismatches(o.facts.decisions[i], exp);
      // Si la acción ya es incorrecta, el resto de campos discrepa como
      // consecuencia: se reporta sólo la causa raíz.
      const roots = bad.includes("action") ? ["action"] : bad;
      for (const field of roots) rules.add(field === "settled" || field === "settledAt" ? "timeout" : ruleFor(id, field));
    });
    for (const rule of [...rules].sort()) findings.push(finding(rule, o.observationId, contractPath, id));
  }

  const present = new Set(behavior.map((o) => o.facts.scenario));
  const missing = REQUIRED_SCENARIOS.filter((s) => !present.has(s));
  if (findings.length) {
    const rules = [...new Set(findings.map((f) => f.ruleId.split("/")[1]))].join(", ");
    return { decision: "deny", reason: `Incumplimientos deterministas: ${rules}.${missing.length ? ` Escenarios sin evidencia: ${missing.length}.` : ""}`, findings };
  }
  if (missing.length === REQUIRED_SCENARIOS.length && isFastMoment(input.event)) return { decision: "warn", reason: deferredReason(input.event) };
  if (missing.length) return { decision: "warn", reason: `Evidencia conductual incompleta: faltan ${missing.length} escenarios (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}).` };
  return { decision: "allow" };
}

module.exports = { version: VERSION, evaluate, contractFindings, mismatches };
