"use strict";

/**
 * Escenarios de `analytics.events` (T25.2): el adapter dispara el flujo real
 * de la app que emite cada evento; el harness inspecciona lo enviado.
 */

const MAX_EVENTS = 10;
const DEFAULT_FORBIDDEN = ["email", "phone", "address", "password", "token", "ssn", "ip", "full_name", "first_name", "last_name", "birth"];

const planned = (facts) => facts.events.slice(0, MAX_EVENTS);
const requiredScenarios = (facts) => [...planned(facts).map((e) => `schema#${e.name}`), "no-pii", "transport-down"];

function expectationsFor(id) {
  if (id.startsWith("schema#")) return [{ emitted: 1, schemaOk: true, noExtra: true }];
  if (id === "no-pii") return [{ piiLeak: false }];
  if (id === "transport-down") return [{ isolated: true, noDuplicates: true }];
  return [];
}

const RULES = { emitted: "emitted-once", schemaOk: "schema", noExtra: "unplanned-properties", piiLeak: "pii-leak", isolated: "failure-isolation", noDuplicates: "duplicate-delivery" };
const ruleFor = (id, fact) => RULES[fact] || "schema";

/** Propiedades del plan cuyo nombre sugiere datos personales (determinista sobre el plan). */
function piiProperties(facts, forbidden = DEFAULT_FORBIDDEN) {
  const out = [];
  for (const e of facts.events) for (const p of e.properties) if (forbidden.some((f) => p.name.toLowerCase() === f || p.name.toLowerCase().includes(f.replace(/_/g, "")))) out.push(`${e.name}.${p.name}`);
  return out;
}

module.exports = { MAX_EVENTS, DEFAULT_FORBIDDEN, planned, requiredScenarios, expectationsFor, ruleFor, piiProperties };
