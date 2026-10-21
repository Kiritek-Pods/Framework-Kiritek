"use strict";

/**
 * Escenarios de `flags.lifecycle` (T21.2): el cliente de flags del equipo
 * frente a un proveedor sintético que responde, cae, se cuelga, devuelve
 * basura o cambia de valor.
 */

const SCENARIOS = ["provider-value", "provider-down", "provider-timeout", "invalid-value", "unknown-flag", "propagation"];
const UNKNOWN_KEY = "kiritek-unregistered-flag";
const DAY = 86400000;
const TEMPORARY = ["release", "experiment"];

/** Flag bajo prueba: el primero con kill switch, si no el primero. */
const flagUnderTest = (flags) => flags.find((f) => f.killSwitch) || flags[0];

/** Valor del proveedor distinto del default, y el valor al que cambia luego. */
function providerValues(def) {
  if (typeof def === "boolean") return [!def, def];
  if (typeof def === "number") return [def + 1, def + 2];
  return [`${def}-b`, `${def}-c`];
}

function harnessParams(facts) {
  if (!facts.client) return null;
  const f = flagUnderTest(facts.flags);
  const [v1, v2] = providerValues(f.defaultValue);
  return { flag: { key: f.key, defaultValue: f.defaultValue }, providerValue: v1, updatedValue: v2, client: facts.client, flags: facts.flags.map((x) => ({ key: x.key, defaultValue: x.defaultValue })) };
}

const requiredScenarios = (facts) => (facts.client ? SCENARIOS : []);

function expectationsFor(id) {
  return {
    "provider-value": [{ result: "provider" }],
    "provider-down": [{ result: "default" }],
    "provider-timeout": [{ result: "default" }],
    "invalid-value": [{ result: "default" }],
    "unknown-flag": [{ result: "falsy" }],
    propagation: [{ result: "provider" }, { result: "updated" }],
  }[id] || [];
}

const RULES = { "provider-value": "provider-value", "provider-down": "fallback-default", "provider-timeout": "timeout", "invalid-value": "invalid-value", "unknown-flag": "unknown-flag", propagation: "propagation" };
const ruleFor = (id) => RULES[id];

/** Reglas deterministas del registro. */
function registryFindings(facts, params, nowIso) {
  const now = Date.parse(nowIso);
  const maxDays = params.maxLifetimeDays || 90;
  const out = [];
  for (const f of facts.flags) {
    if (TEMPORARY.includes(f.kind)) {
      if (!f.removeBy) out.push({ rule: "remove-by-missing", subject: f.key });
      else {
        if (Date.parse(f.removeBy) <= now) out.push({ rule: "flag-expired", subject: f.key });
        if (Date.parse(f.removeBy) - Date.parse(f.createdAt) > maxDays * DAY) out.push({ rule: "flag-lifetime", subject: f.key });
      }
    }
    if (f.kind === "permission" && f.defaultValue !== false) out.push({ rule: "unsafe-default", subject: f.key });
    if (f.killSwitch && typeof f.defaultValue !== "boolean") out.push({ rule: "kill-switch-type", subject: f.key });
  }
  if (facts.client && params.maxClientTimeoutMs && facts.client.timeoutMs > params.maxClientTimeoutMs) out.push({ rule: "contract-timeout", subject: "client" });
  return out;
}

/** Aviso (no incumplimiento): flags temporales que vencen pronto. */
function expiringSoon(facts, params, nowIso) {
  const now = Date.parse(nowIso);
  const days = params.expiryWarningDays || 14;
  return facts.flags.filter((f) => TEMPORARY.includes(f.kind) && f.removeBy && Date.parse(f.removeBy) > now && Date.parse(f.removeBy) - now <= days * DAY).length;
}

module.exports = { SCENARIOS, UNKNOWN_KEY, flagUnderTest, providerValues, harnessParams, requiredScenarios, expectationsFor, ruleFor, registryFindings, expiringSoon };
