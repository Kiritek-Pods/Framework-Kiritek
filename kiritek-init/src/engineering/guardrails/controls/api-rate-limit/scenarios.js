"use strict";

/** Escenarios de `api.rate-limit` (T34.2): un escenario por límite declarado. */

const MAX_LIMITS = 5;
const MAX_REQUESTS = 1000; // límites mayores no se prueban (quedan sin evidencia ⇒ warn)

const requiredScenarios = (facts) => facts.limits.slice(0, MAX_LIMITS).map((l) => `limit@${l.id}`);
const expectationsFor = () => [{ underLimitOk: true, limited: true, retryAfterOk: true, perClient: true, windowReset: true }];
const RULES = { underLimitOk: "under-limit", limited: "limit-enforced", retryAfterOk: "retry-after", perClient: "per-client", windowReset: "window-reset" };
const ruleFor = (id, fact) => RULES[fact] || "limit-enforced";

module.exports = { MAX_LIMITS, MAX_REQUESTS, requiredScenarios, expectationsFor, ruleFor };
