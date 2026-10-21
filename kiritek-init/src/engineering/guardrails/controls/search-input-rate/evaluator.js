"use strict";

/**
 * Evaluator puro de `search.input-rate` (T10.3–T10.4; design §10.1).
 *
 * Decide sólo desde las trazas normalizadas del harness (reloj virtual,
 * transporte controlado, consultas sintéticas opacas). No exige debounce ni
 * throttle ni librería: verifica propiedades conductuales.
 *
 *   cadence       en ráfaga, dos inicios de búsqueda más cerca que windowMs
 *   minimum       búsqueda iniciada con menos de minChars (sin excepción)
 *   stale-order   una respuesta más vieja reemplaza resultados más nuevos
 *   cancellation  plataforma cancelable y la solicitud obsoleta no se cancela
 *   dedupe        consultas equivalentes repiten trabajo dentro de la ventana
 *   propagation   error no mostrado, o cancelación mostrada como error
 *
 * Sin contrato o con señales estáticas: sólo warn heurístico (R9.7).
 */

const { REQUIRED_SCENARIOS } = require("./scenarios.js");
const { isFastMoment, deferredReason } = require("../shared/moments.js");

const VERSION = "1.0.0";
const CONTROL = "search.input-rate";

const RULES = Object.freeze({
  cadence: { severity: "high", remediation: "Aplique la política de cadencia declarada (debounce, throttle u otro mecanismo equivalente) para que una ráfaga no inicie búsquedas más seguidas que windowMs." },
  minimum: { severity: "medium", remediation: "No inicie la búsqueda costosa por debajo de minChars, o declare y pruebe una excepción funcional (minCharsException)." },
  "stale-order": { severity: "high", remediation: "Impida que una respuesta de una consulta anterior reemplace resultados de una consulta más reciente (token/secuencia de la última consulta o cancelación)." },
  cancellation: { severity: "medium", remediation: "La plataforma soporta cancelación: cancele (AbortSignal u equivalente) la solicitud que una nueva consulta vuelve obsoleta." },
  dedupe: { severity: "low", remediation: "Deduplique consultas equivalentes dentro de dedupeWindowMs (cache, comparación normalizada o equivalente)." },
  propagation: { severity: "medium", remediation: "Muestre los errores reales de búsqueda y no presente cancelaciones como errores al usuario." },
});

function indexEvents(events) {
  const keyOf = new Map();
  const lastInputSeq = new Map();
  const ridToQid = new Map();
  for (const e of events) {
    if (e.qid && e.key) keyOf.set(e.qid, e.key);
    if (e.type === "input") lastInputSeq.set(e.qid, e.seq);
    if (e.type === "request-start") ridToQid.set(e.rid, e.qid);
  }
  return { keyOf, lastInputSeq, ridToQid };
}

function checkCadence(events, p) {
  const starts = events.filter((e) => e.type === "request-start").map((e) => e.t);
  for (let i = 1; i < starts.length; i += 1) if (starts[i] - starts[i - 1] < p.windowMs) return true;
  return false;
}

function checkMinimum(events, p, exception) {
  return !exception && events.some((e) => e.type === "request-start" && e.len < p.minChars);
}

function checkStaleOrder(events) {
  const { lastInputSeq, keyOf } = indexEvents(events);
  let newestCommitted = -1;
  for (const e of events.filter((x) => x.type === "commit")) {
    const order = lastInputSeq.has(e.qid) ? lastInputSeq.get(e.qid) : -1;
    // Una consulta equivalente a la más reciente no es obsoleta.
    if (order < newestCommitted) {
      const newestKey = [...lastInputSeq.entries()].find(([, s]) => s === newestCommitted);
      if (!newestKey || keyOf.get(newestKey[0]) !== keyOf.get(e.qid)) return true;
    }
    newestCommitted = Math.max(newestCommitted, order);
  }
  return false;
}

function checkCancellation(events) {
  const { keyOf } = indexEvents(events);
  const inputs = events.filter((e) => e.type === "input");
  for (const start of events.filter((e) => e.type === "request-start")) {
    const newer = inputs.find((i) => i.seq > start.seq && keyOf.get(i.qid) !== keyOf.get(start.qid));
    if (!newer) continue;
    const ended = events.find((e) => (e.type === "response" || e.type === "request-abort") && e.rid === start.rid);
    if (ended && ended.type === "response" && ended.seq > newer.seq) return true;
  }
  return false;
}

function checkDedupe(events, p) {
  if (!p.dedupeWindowMs) return false;
  const starts = events.filter((e) => e.type === "request-start");
  for (let i = 0; i < starts.length; i += 1) {
    for (let j = i + 1; j < starts.length; j += 1) {
      if (starts[i].key === starts[j].key && starts[j].t - starts[i].t < p.dedupeWindowMs) return true;
    }
  }
  return false;
}

function checkPropagation(events) {
  const { ridToQid } = indexEvents(events);
  const failed = events.filter((e) => e.type === "response" && e.ok === false).map((e) => ridToQid.get(e.rid));
  const surfaced = events.filter((e) => e.type === "error-surfaced");
  if (failed.some((q) => !surfaced.some((s) => s.qid === q && !s.aborted))) return true;
  return surfaced.some((s) => s.aborted);
}

function finding(rule, scenario, obs, contractPath) {
  return {
    ruleId: `${CONTROL}/${rule}`,
    path: contractPath,
    severity: RULES[rule].severity,
    fingerprint: `sir:${rule}:${scenario}`,
    remediation: RULES[rule].remediation,
    evidenceClass: "deterministic",
    observationRefs: [obs.observationId],
  };
}

function evaluate(input) {
  const obs = input.observations;
  const contract = obs.find((o) => o.kind === "search-contract");
  const contractPath = input.effectiveConfig.behaviorContract || input.unit.root;

  if (!contract || !contract.facts.declared) {
    const signals = obs.find((o) => o.kind === "search-signals");
    const findings = ((signals && signals.facts.signals) || []).map((s, i) => ({
      ruleId: `${CONTROL}/behavior-evidence-missing`,
      path: s.path,
      severity: "low",
      fingerprint: `sir:signal:${i}:${s.path}`,
      remediation: "Posible input de búsqueda remota sin evidencia conductual. Declare behaviorContract y ejecute el harness; un handler o llamada de red no prueba incumplimiento.",
      evidenceClass: "heuristic",
    }));
    return {
      decision: "warn",
      reason: "Falta evidencia conductual (behaviorContract): señales estáticas no prueban cadencia, mínimo, cancelación ni dedupe.",
      ...(findings.length ? { findings } : {}),
    };
  }
  if (!contract.facts.valid) {
    return { decision: "error", reason: `CONTRACT_INVALID: contrato conductual inválido (${contract.facts.errorCodes.join(", ")})` };
  }
  if (contract.facts.triggers === "local") {
    return { decision: "warn", reason: "LOCAL_SEARCH_REQUIRES_GOVERNED_NA: búsqueda local; declare N/A gobernado con costo medido bajo el umbral, owner y evidencia." };
  }

  const scenarios = new Map(obs.filter((o) => o.kind === "search-behavior").map((o) => [o.facts.scenario, o]));
  const findings = [];
  for (const [id, o] of [...scenarios.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const p = o.facts.params;
    const ev = o.facts.events;
    if (id === "burst" && checkCadence(ev, p)) findings.push(finding("cadence", id, o, contractPath));
    if (checkMinimum(ev, p, o.facts.minCharsException)) findings.push(finding("minimum", id, o, contractPath));
    if (checkStaleOrder(ev)) findings.push(finding("stale-order", id, o, contractPath));
    if (id === "supersede" && p.cancellation === "supported" && checkCancellation(ev)) findings.push(finding("cancellation", id, o, contractPath));
    if (id === "equivalent" && checkDedupe(ev, p)) findings.push(finding("dedupe", id, o, contractPath));
    if (id === "error-propagation" && checkPropagation(ev)) findings.push(finding("propagation", id, o, contractPath));
  }
  const missing = REQUIRED_SCENARIOS.filter((s) => !scenarios.has(s));
  if (findings.length) {
    const rules = [...new Set(findings.map((f) => f.ruleId.split("/")[1]))].join(", ");
    return { decision: "deny", reason: `Incumplimiento conductual reproducible en el harness: ${rules}.${missing.length ? ` Escenarios sin evidencia: ${missing.join(", ")}.` : ""}`, findings };
  }
  if (missing.length === REQUIRED_SCENARIOS.length && isFastMoment(input.event)) return { decision: "warn", reason: deferredReason(input.event) };
  if (missing.length) return { decision: "warn", reason: `Evidencia conductual incompleta: faltan escenarios ${missing.join(", ")}.` };
  return { decision: "allow" };
}

module.exports = { version: VERSION, evaluate, RULES };
