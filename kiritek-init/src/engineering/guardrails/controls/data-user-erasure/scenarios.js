"use strict";

/** Escenarios de `data.user-erasure` (T47.2). Dos usuarios sintéticos con datos canario. */

const MAX_STORES = 10;
const requiredScenarios = (facts) => [...facts.stores.slice(0, MAX_STORES).map((s) => `store@${s.id}`), "others", facts.reads.length && "reads", "repeat", "unknown"].filter(Boolean);

function expectationsFor(id) {
  return {
    store: [{ accepted: true, clean: true }],
    others: [{ intact: true }],
    reads: [{ noReappearance: true }],
    repeat: [{ noServerError: true }],
    unknown: [{ noServerError: true, nothingDeleted: true }],
  }[id.split("@")[0]] || [];
}

const RULES = {
  store: { accepted: "erasure-status", clean: "erasure-incomplete" },
  others: { default: "collateral-deletion" },
  reads: { default: "erased-reappears" },
  repeat: { default: "erasure-not-idempotent" },
  unknown: { default: "erasure-unknown-user" },
};
function ruleFor(id, fact) {
  const r = RULES[id.split("@")[0]] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_STORES, requiredScenarios, expectationsFor, ruleFor };
