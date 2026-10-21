"use strict";

/**
 * Escenarios y expectativas de `app.minimum-supported-version` (R10.13;
 * T11.2–T11.5). Módulo PURO: lo usan el harness (estímulos) y el evaluator
 * (expectativas a partir del contrato declarado).
 *
 * Tiempos: reloj virtual en ms. `SERVER_T0` es el tiempo confiable del
 * servidor; el reloj local del dispositivo puede diferir (manipulación).
 * Las versiones y políticas son sintéticas; no hay datos de usuarios.
 */

const SERVER_T0 = 1800000000000;
const DAY = 86400000;
const MINIMUM = "2.0.0";

/**
 * @param {object} p  { environment, cacheTtlSeconds, staleIfOfflineSeconds, timeoutMs, platform, enterprise }
 * @returns {Record<string, object>} id → plan
 *
 * plan: { installed, platform, deviceStart, cache?, store?, steps: [
 *   { advanceMs, transport: "ok"|"offline"|"hang"|"invalid-payload", policy?, signature? } ] }
 */
function buildScenarios(p) {
  const policy = (over = {}) => ({ minimumVersion: MINIMUM, issuedAt: SERVER_T0, ...over });
  const ok = (pol, signature = "valid") => ({ advanceMs: 0, transport: "ok", policy: pol, signature });
  const base = { platform: p.platform, deviceStart: SERVER_T0, store: { available: true } };
  const s = {
    "below-min": { ...base, installed: "1.9.0", steps: [ok(policy())] },
    "equal-min": { ...base, installed: "2.0.0", steps: [ok(policy())] },
    "above-min": { ...base, installed: "2.1.0", steps: [ok(policy())] },
    "prerelease-below": { ...base, installed: "2.0.0-rc.1", steps: [ok(policy())] },
    "build-metadata": { ...base, installed: "2.0.0+build.7", steps: [ok(policy())] },
    lexicographic: { ...base, installed: "1.10.0", steps: [ok(policy({ minimumVersion: "1.9.0" }))] },
    soft: { ...base, installed: "2.0.0", steps: [ok(policy({ minimumVersion: "1.0.0", softMinimumVersion: "2.1.0" }))] },
    "invalid-payload": { ...base, installed: "1.9.0", steps: [{ advanceMs: 0, transport: "invalid-payload" }] },
    "invalid-signature": { ...base, installed: "1.9.0", steps: [ok(policy({ minimumVersion: "99.0.0" }), "invalid")] },
    timeout: { ...base, installed: "1.9.0", steps: [{ advanceMs: 0, transport: "hang" }] },
    "offline-first-run": { ...base, installed: "1.9.0", steps: [{ advanceMs: 0, transport: "offline" }] },
    "offline-valid-cache": {
      ...base,
      installed: "1.9.0",
      cache: { policy: policy(), storedAtOffsetMs: -Math.floor((p.cacheTtlSeconds * 1000) / 2) },
      steps: [{ advanceMs: 0, transport: "offline" }],
    },
    "offline-expired-cache": {
      ...base,
      installed: "1.9.0",
      cache: { policy: policy(), storedAtOffsetMs: -(p.staleIfOfflineSeconds * 1000 + 1000) },
      steps: [{ advanceMs: 0, transport: "offline" }],
    },
    "grace-active": { ...base, installed: "1.9.0", steps: [ok(policy({ graceUntil: SERVER_T0 + DAY }))] },
    // El reloj local dice "aún en gracia", el servidor dice que ya venció.
    "grace-local-clock": { ...base, installed: "1.9.0", deviceStart: SERVER_T0 - 3 * DAY, serverOffsetMs: 3 * DAY, steps: [ok(policy({ graceUntil: SERVER_T0 - DAY }))] },
    "store-unavailable": { ...base, installed: "1.9.0", store: { available: false }, steps: [ok(policy())] },
    rollback: {
      ...base,
      installed: "1.9.0",
      steps: [ok(policy({ minimumVersion: "9.0.0" })), { advanceMs: p.cacheTtlSeconds * 1000 + 1000, transport: "ok", policy: policy({ minimumVersion: "1.0.0", issuedAt: SERVER_T0 + 1 }), signature: "valid" }],
    },
    "override-valid": { ...base, installed: "1.9.0", steps: [ok(policy({ overrides: [{ id: "ov-1", authenticated: true, environment: p.environment, audience: "all", expiresAt: SERVER_T0 + DAY, effect: "lift" }] }))] },
    "override-expired": { ...base, installed: "1.9.0", steps: [ok(policy({ overrides: [{ id: "ov-2", authenticated: true, environment: p.environment, audience: "all", expiresAt: SERVER_T0 - DAY, effect: "lift" }] }))] },
    "override-unauthenticated": { ...base, installed: "1.9.0", steps: [ok(policy({ overrides: [{ id: "ov-3", authenticated: false, environment: p.environment, audience: "all", expiresAt: SERVER_T0 + DAY, effect: "lift" }] }))] },
    "override-other-environment": { ...base, installed: "1.9.0", steps: [ok(policy({ overrides: [{ id: "ov-4", authenticated: true, environment: `${p.environment}-otro`, audience: "all", expiresAt: SERVER_T0 + DAY, effect: "lift" }] }))] },
  };
  if (p.enterprise) s["enterprise-store"] = { ...base, platform: "enterprise", installed: "1.9.0", steps: [ok(policy())] };
  return s;
}

const REQUIRED_SCENARIOS = Object.freeze(Object.keys(buildScenarios({ environment: "x", cacheTtlSeconds: 60, staleIfOfflineSeconds: 60, timeoutMs: 1000, platform: "ios" })));

const HARD = { action: ["hard"], canContinue: false, explanationAccessible: true, exitAvailable: true, updateTarget: ["store"] };
const NONE = { action: ["none"] };

function offlineFirstRun(c) {
  return c.offline.firstRun === "allow-with-warning"
    ? { action: ["none"], canContinue: true }
    : { action: ["blocked-offline"], canContinue: false, explanationAccessible: true, exitAvailable: true };
}

/**
 * Expectativas por decisión para un escenario, derivadas del contrato.
 * @returns {object[]} una restricción por decisión esperada
 */
function expectationsFor(id, c, p) {
  switch (id) {
    case "below-min":
    case "prerelease-below":
    case "override-expired":
    case "override-unauthenticated":
    case "override-other-environment":
    case "grace-local-clock":
      return [HARD];
    case "equal-min":
    case "above-min":
    case "build-metadata":
    case "lexicographic":
      return [NONE];
    case "soft":
      return [{ action: ["soft"], canContinue: true, canPostpone: c.soft.postponeFrequencyHours > 0 }];
    case "invalid-payload":
    case "invalid-signature":
    case "offline-first-run":
      return [offlineFirstRun(c)];
    case "timeout":
      return [{ ...offlineFirstRun(c), maxSettleMs: p.timeoutMs + 1000 }];
    case "offline-valid-cache":
      return [{ ...HARD, policySource: ["cache"] }];
    case "offline-expired-cache":
      if (c.offline.expiredCache === "allow-with-warning") return [{ action: ["none"], canContinue: true }];
      if (c.offline.expiredCache === "use-stale-with-warning") return [{ ...HARD, policySource: ["stale-cache"] }];
      return [{ action: ["blocked-offline"], canContinue: false, explanationAccessible: true, exitAvailable: true }];
    case "grace-active":
      return [c.grace.allowed ? { action: ["soft"], canContinue: true } : HARD];
    case "store-unavailable":
      return [{ action: ["hard"], explanationAccessible: true, exitAvailable: true, updateTarget: ["fallback", "none"] }];
    case "enterprise-store":
      return [{ ...HARD, updateTarget: ["enterprise"] }];
    case "rollback":
      return [{ action: ["hard"] }, NONE];
    case "override-valid":
      return [{ action: ["none", "soft"], canContinue: true }];
    default:
      return [];
  }
}

const RULE_BY_SCENARIO = Object.freeze({
  "below-min": "version-comparison",
  "equal-min": "version-comparison",
  "above-min": "version-comparison",
  "prerelease-below": "version-comparison",
  "build-metadata": "version-comparison",
  lexicographic: "version-comparison",
  soft: "soft-flow",
  "invalid-payload": "untrusted-payload",
  "invalid-signature": "untrusted-payload",
  timeout: "timeout",
  "offline-first-run": "offline-policy",
  "offline-valid-cache": "offline-policy",
  "offline-expired-cache": "offline-policy",
  "grace-active": "grace",
  "grace-local-clock": "grace",
  "store-unavailable": "store-fallback",
  "enterprise-store": "store-fallback",
  rollback: "rollback",
  "override-valid": "override",
  "override-expired": "override",
  "override-unauthenticated": "override",
  "override-other-environment": "override",
});

/** Regla a la que se atribuye una discrepancia de campo en un escenario. */
function ruleFor(id, field) {
  const base = RULE_BY_SCENARIO[id];
  if (base === "version-comparison" && field !== "action") return "hard-flow";
  return base;
}

module.exports = { SERVER_T0, DAY, MINIMUM, buildScenarios, REQUIRED_SCENARIOS, expectationsFor, ruleFor, RULE_BY_SCENARIO };
