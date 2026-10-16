"use strict";

/** Escenarios de `api.error-responses` (T33.2). */

const MAX_ENDPOINTS = 5;

function scenarioIds(facts) {
  const out = ["not-found"];
  for (const e of facts.endpoints.slice(0, MAX_ENDPOINTS)) out.push(`invalid@${e.id}`, `malformed@${e.id}`, `internal@${e.id}`);
  return out;
}

const requiredScenarios = (facts) => scenarioIds(facts);
const expectationsFor = () => [{ statusOk: true, formatOk: true, noLeak: true }];

const STATUS_RULE = { invalid: "validation-status", malformed: "malformed-body", "not-found": "not-found-status", internal: "internal-status" };
function ruleFor(id, fact) {
  if (fact === "formatOk") return "error-format";
  if (fact === "noLeak") return "no-internal-details";
  return STATUS_RULE[id.split("@")[0]];
}

module.exports = { MAX_ENDPOINTS, scenarioIds, requiredScenarios, expectationsFor, ruleFor };
