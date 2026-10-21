"use strict";

/** Escenarios de `api.versioning` (T40.2). Por endpoint, sobre todas las versiones declaradas. */

const MAX_ENDPOINTS = 5;
const UNKNOWN_VERSION = "v999";
const scenariosFor = (p) => ["served", "deprecation", "unknown", p.versions.some((v) => v.status === "retired") && "retired", p.versions.some((v) => v.status !== "retired" && v.requiredFields.length) && "compatible"].filter(Boolean);
const split = (id) => {
  const [scenario, endpoint] = id.split("@");
  return { scenario, endpoint };
};
const requiredScenarios = (facts) => facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => scenariosFor(facts).map((s) => `${s}@${e.id}`));

function expectationsFor(id) {
  return {
    served: [{ allServed: true }],
    deprecation: [{ deprecatedMarked: true, sunsetMarked: true, supportedClean: true }],
    unknown: [{ rejected: true }],
    retired: [{ gone: true }],
    compatible: [{ fieldsKept: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  served: { default: "version-served" },
  deprecation: { deprecatedMarked: "deprecation-header", sunsetMarked: "sunset-header", supportedClean: "false-deprecation" },
  unknown: { default: "unknown-version" },
  retired: { default: "retired-version" },
  compatible: { default: "breaking-change" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_ENDPOINTS, UNKNOWN_VERSION, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
