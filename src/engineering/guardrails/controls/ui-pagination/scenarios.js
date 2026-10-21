"use strict";

/**
 * Escenarios de `ui.pagination` (T24.2). Dataset sintético de
 * `pageSize × 2 + 3` ítems opacos; el transporte pagina por cursor u offset.
 */

const MAX_LISTS = 5;

const datasetSize = (l) => l.pageSize * 2 + 3;
const minRequests = (l) => Math.ceil(datasetSize(l) / l.pageSize);

const scenariosFor = (l) => ["first-page", "all-pages", "load-after-end", "concurrent-load", "page-error", l.mode === "cursor" && "shifting"].filter(Boolean);

const split = (id) => {
  const [scenario, list] = id.split("@");
  return { scenario, list };
};

const requiredScenarios = (facts) => facts.lists.slice(0, MAX_LISTS).flatMap((l) => scenariosFor(l).map((s) => `${s}@${l.id}`));

function expectationsFor(id, params) {
  const { scenario, list } = split(id);
  const l = (params.lists || []).find((x) => x.id === list) || {};
  switch (scenario) {
    case "first-page":
      return [{ count: l.pageSize, requests: 1, limitOk: true }];
    case "all-pages":
      return [{ complete: true, noDuplicates: true, ordered: true, requestsOk: true, ...(l.endState === "required" ? { endShown: true } : {}) }];
    case "load-after-end":
      return [{ requestsAfterEnd: 0 }];
    case "concurrent-load":
      return [{ noDuplicates: true, singleFlight: true }];
    case "page-error":
      return [{ kept: true, error: true }, { recovered: true }];
    case "shifting":
      return [{ noDuplicates: true, noSkipped: true }];
    default:
      return [];
  }
}

const RULES = {
  "first-page": { limitOk: "page-size", default: "first-page" },
  "all-pages": { complete: "complete", noDuplicates: "duplicates", ordered: "order", endShown: "end-state", requestsOk: "extra-requests" },
  "load-after-end": { default: "load-after-end" },
  "concurrent-load": { default: "concurrent-load" },
  "page-error": { kept: "keep-on-error", error: "error-state", recovered: "retry" },
  shifting: { default: "stable-cursor" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_LISTS, datasetSize, minRequests, scenariosFor, requiredScenarios, expectationsFor, ruleFor, split };
