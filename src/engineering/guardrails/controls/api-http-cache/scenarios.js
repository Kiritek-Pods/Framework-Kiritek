"use strict";

/** Escenarios de `api.http-cache` (T42.2). Un recurso sintético por usuario. */

const MAX_RESOURCES = 5;
const scenariosFor = (r) => ["headers", "validator", "not-modified", "changed", r.visibility === "private" && r.validator === "etag" && "per-user"].filter(Boolean);
const split = (id) => {
  const [scenario, resource] = id.split("@");
  return { scenario, resource };
};
const requiredScenarios = (facts) => facts.resources.slice(0, MAX_RESOURCES).flatMap((r) => scenariosFor(r).map((s) => `${s}@${r.id}`));

function expectationsFor(id) {
  return {
    headers: [{ ok: true, hasCacheControl: true, maxAgeOk: true, privateOk: true }],
    validator: [{ hasValidator: true }],
    "not-modified": [{ is304: true, emptyBody: true }],
    changed: [{ fresh: true }],
    "per-user": [{ isolated: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  headers: { ok: "cache-control-missing", hasCacheControl: "cache-control-missing", maxAgeOk: "max-age", privateOk: "private-cacheable" },
  validator: { default: "validator-missing" },
  "not-modified": { is304: "conditional-get", emptyBody: "not-modified-body" },
  changed: { default: "stale-validator" },
  "per-user": { default: "cross-user-validator" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_RESOURCES, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
