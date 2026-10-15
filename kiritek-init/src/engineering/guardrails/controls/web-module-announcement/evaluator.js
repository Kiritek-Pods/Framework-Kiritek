"use strict";

/**
 * Evaluator puro de `web.module-announcement` (T12.1–T12.7).
 *
 * Evidencia determinista (R11.9): ausencia de señal requerida según el
 * launch manifest, metadata inválida (schema o reglas semánticas), N/A
 * gobernado inválido y tests contractuales fallidos. La inferencia de
 * "módulo nuevo" por ruta/diff sólo produce warn heurístico (R11.10).
 * Faltar tests no es incumplimiento: sólo avisa.
 */

const { REQUIRED_SCENARIOS, expectationsFor, ruleFor } = require("./scenarios.js");
const { isFastMoment, deferredReason } = require("../shared/moments.js");

const VERSION = "1.0.0";
const CONTROL = "web.module-announcement";

const REMEDIATION = {
  "metadata-invalid": "Corrija el launch manifest (ruta, JSON, ids únicos y schema web-module-announcement.manifest).",
  "required-signal-missing": "El módulo declara announcementRequired: vincúlelo a un anuncio existente (announcementId) o a un N/A gobernado (governedNaRef).",
  "invalid-na": "El N/A gobernado debe existir, corresponder al módulo, estar vigente (reviewBy futuro) y, si la criticidad es alta, tener segunda aprobación.",
  window: "La ventana del anuncio debe terminar después de empezar.",
  "audience-pii": "Las audiencias sólo pueden usar criterios permitidos (rol, plan, región, cohorte…) sin emails, teléfonos ni identificadores de personas.",
  "channels-unsupported": "Use sólo canales soportados por el workspace (parameters.supportedChannels) y declarados en el anuncio.",
  "channel-unreachable": "Cada audiencia necesita al menos un canal soportado del anuncio o un fallbackChannel soportado.",
  "content-localization": "defaultLocale debe estar entre los locales declarados del contenido.",
  "show-once-key": "Cada anuncio necesita una clave show-once propia: claves repetidas deduplican anuncios distintos.",
  "rollout-traceability": "El estado de rollout debe coincidir con la última entrada del historial, ordenado cronológicamente.",
  "show-once": "Deduplique por clave/alcance/periodo declarados y aplique el tratamiento declarado cuando el storage no esté disponible o se borre, sin romper el módulo.",
  rollout: "Pausar o retirar el anuncio no debe retirar el módulo; reactivarlo debe volver a mostrarlo.",
  targeting: "No muestre el anuncio fuera de su ventana ni a audiencias no incluidas.",
  keyboard: "Todos los controles del anuncio deben ser alcanzables con teclado (Tab).",
  focus: "Al abrir, el foco debe ir al anuncio o a uno de sus controles.",
  "name-role-state": "El anuncio necesita rol válido, nombre accesible, controles con nombre y estado coherente con el rol.",
  close: "El anuncio debe poder cerrarse con Escape y un control de cierre, devolviendo el foco al origen.",
  contrast: "El texto del anuncio debe cumplir el contraste del estándar adoptado.",
  "reduced-motion": "Con prefers-reduced-motion, desactive o anule la animación.",
  localization: "Si falta el locale del usuario, use el locale por defecto; nunca muestre claves internas.",
  "content-fallback": "Si falta contenido, aplique el fallback declarado; nunca muestre claves internas, texto vacío ni markup roto.",
};
const SEVERITY = { "metadata-invalid": "high", "required-signal-missing": "high", "invalid-na": "high", "audience-pii": "high", keyboard: "high", close: "high", rollout: "high" };

/** Reglas semánticas del manifest (más allá del schema). */
function manifestFindings(m, params, nowIso) {
  const out = [];
  const add = (rule, subject) => out.push({ rule, subject });
  const anns = new Map(m.announcements.map((a) => [a.id, a]));
  const nas = new Map(m.governedNa.map((n) => [n.ref, n]));
  const now = Date.parse(nowIso);
  for (const mod of [...m.modules].sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1))) {
    if (mod.governedNaRef) {
      const na = nas.get(mod.governedNaRef);
      const expired = na && Date.parse(na.reviewBy) <= now;
      if (!na || na.moduleId !== mod.moduleId || expired || (na.criticality === "high" && !na.secondApproval)) add("invalid-na", mod.moduleId);
    } else if (mod.announcementId) {
      if (!anns.has(mod.announcementId)) add("required-signal-missing", mod.moduleId);
    } else if (mod.announcementRequired) {
      add("required-signal-missing", mod.moduleId);
    }
  }
  const supported = new Set(params.supportedChannels || []);
  const keys = new Map();
  for (const a of [...m.announcements].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (Date.parse(a.window.end) <= Date.parse(a.window.start)) add("window", a.id);
    if (a.audiences.some((au) => au.sensitive)) add("audience-pii", a.id);
    if (a.channels.some((ch) => !supported.has(ch)) || a.audiences.some((au) => au.channels.some((ch) => !a.channels.includes(ch)))) add("channels-unsupported", a.id);
    const reachable = (au) => au.channels.some((ch) => supported.has(ch) && a.channels.includes(ch)) || (au.fallbackChannel && supported.has(au.fallbackChannel));
    if (!a.audiences.every(reachable)) add("channel-unreachable", a.id);
    if (!a.content.locales.includes(a.content.defaultLocale)) add("content-localization", a.id);
    if (keys.has(a.showOnce.key)) add("show-once-key", a.id);
    keys.set(a.showOnce.key, a.id);
    if (a.rollout.lastHistoryState !== a.rollout.state || !a.rollout.historyOrdered) add("rollout-traceability", a.id);
  }
  return out;
}

/** Campos discrepantes entre un paso observado y su expectativa. */
function mismatches(step, exp) {
  if (!step) return ["missing"];
  const bad = [];
  for (const [k, want] of Object.entries(exp)) {
    if (Array.isArray(want) ? !want.includes(step[k]) : step[k] !== want) bad.push(k);
  }
  return bad;
}

function finding(rule, ref, path, fpSuffix) {
  return {
    ruleId: `${CONTROL}/${rule}`,
    path,
    severity: SEVERITY[rule] || "medium",
    fingerprint: `wma:${rule}${fpSuffix ? `:${fpSuffix}` : ""}`,
    remediation: REMEDIATION[rule],
    evidenceClass: "deterministic",
    observationRefs: [ref],
  };
}

function evaluate(input) {
  const params = input.effectiveConfig;
  const obs = input.observations;
  const manifestObs = obs.find((o) => o.kind === "announcement-manifest");
  const manifestPath = params.launchManifest || input.unit.root;

  if (!manifestObs || !manifestObs.facts.declared) {
    const signals = obs.find((o) => o.kind === "announcement-signals");
    const findings = ((signals && signals.facts.signals) || []).map((s) => ({
      ruleId: `${CONTROL}/launch-confirmation`,
      path: s.path,
      severity: "low",
      fingerprint: `wma:signal:${s.path}`,
      remediation: "Posible módulo nuevo inferido por ruta: confirme el lanzamiento en el launch manifest (anuncio o N/A gobernado). La ruta no prueba que requiera anuncio.",
      evidenceClass: "heuristic",
    }));
    return {
      decision: "warn",
      reason: findings.length ? "Posible módulo nuevo sin launch manifest: confirme el lanzamiento." : "Falta el launch manifest: no hay señal explícita que vincule módulos con anuncios o N/A gobernado.",
      ...(findings.length ? { findings } : {}),
    };
  }

  const findings = [];
  if (!manifestObs.facts.valid) {
    findings.push(finding("metadata-invalid", manifestObs.observationId, manifestPath, manifestObs.facts.errorCodes.join("-").toLowerCase()));
    return { decision: "deny", reason: `Launch manifest inválido (${manifestObs.facts.errorCodes.join(", ")}).`, findings };
  }
  const m = manifestObs.facts.manifest;
  for (const { rule, subject } of manifestFindings(m, params, input.clockRef)) findings.push(finding(rule, manifestObs.observationId, manifestPath, subject));

  const behavior = obs.filter((o) => o.kind === "announcement-behavior").sort((a, b) => (a.facts.scenario < b.facts.scenario ? -1 : 1));
  for (const o of behavior) {
    const id = o.facts.scenario;
    const expected = expectationsFor(id, o.facts.params);
    if (expected.some((exp, i) => mismatches(o.facts.steps[i], exp).length)) findings.push(finding(ruleFor(id), o.observationId, manifestPath, id));
  }

  const needsTests = m.announcements.some((a) => a.rollout.state !== "retired");
  const present = new Set(behavior.map((o) => o.facts.scenario));
  const missing = needsTests ? REQUIRED_SCENARIOS.filter((s) => !present.has(s)) : [];
  if (findings.length) {
    const rules = [...new Set(findings.map((f) => f.ruleId.split("/")[1]))].join(", ");
    return { decision: "deny", reason: `Incumplimientos deterministas: ${rules}.${missing.length ? ` Escenarios sin evidencia: ${missing.length}.` : ""}`, findings };
  }
  if (missing.length && !present.size && m.hasHarness && isFastMoment(input.event)) return { decision: "warn", reason: deferredReason(input.event) };
  if (missing.length) {
    const why = m.hasHarness ? `faltan ${missing.length} escenarios (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""})` : "el manifest no declara harness";
    return { decision: "warn", reason: `Tests contractuales de anuncio incompletos: ${why}.` };
  }
  const na = m.modules.filter((x) => x.governedNaRef).length;
  return { decision: "allow", ...(na ? { reason: `${na} módulo(s) con N/A gobernado vigente.` } : {}) };
}

module.exports = { version: VERSION, evaluate, manifestFindings, mismatches };
