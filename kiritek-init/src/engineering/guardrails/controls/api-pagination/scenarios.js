"use strict";

/** Escenarios de `api.pagination` (T35.2). Dataset sintético de ítems opacos. */

const MAX_COLLECTIONS = 5;
const datasetSize = (c) => c.defaultPageSize * 2 + 3;
const scenariosFor = (c) => ["default-size", "max-size", "walk", "bad-limit", c.mode === "cursor" && "stable-cursor", c.mode === "cursor" && "invalid-cursor"].filter(Boolean);
const split = (id) => {
  const [scenario, collection] = id.split("@");
  return { scenario, collection };
};
const requiredScenarios = (facts) => facts.collections.slice(0, MAX_COLLECTIONS).flatMap((c) => scenariosFor(c).map((s) => `${s}@${c.id}`));

function expectationsFor(id) {
  return {
    "default-size": [{ ok: true, defaultSizeOk: true }],
    "max-size": [{ capped: true }],
    walk: [{ complete: true, noDuplicates: true, ordered: true, requestsOk: true }],
    "bad-limit": [{ noServerError: true }],
    "stable-cursor": [{ noDuplicates: true, noSkipped: true }],
    "invalid-cursor": [{ clientError: true }],
  }[split(id).scenario] || [];
}

const RULES = {
  "default-size": { default: "default-page-size" },
  "max-size": { default: "max-page-size" },
  walk: { complete: "complete", noDuplicates: "duplicates", ordered: "order", requestsOk: "end-detection" },
  "bad-limit": { default: "invalid-limit" },
  "stable-cursor": { default: "stable-cursor" },
  "invalid-cursor": { default: "invalid-cursor" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_COLLECTIONS, datasetSize, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
