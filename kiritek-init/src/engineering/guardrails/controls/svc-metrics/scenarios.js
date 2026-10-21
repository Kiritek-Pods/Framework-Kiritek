"use strict";

/** Escenarios de `svc.metrics` (T48.2). */

const MAX_ENDPOINTS = 5;
const PER_ENDPOINT = ["counted", "errors", "latency", "cardinality"];
const requiredScenarios = (facts) => ["exposed", ...facts.endpoints.slice(0, MAX_ENDPOINTS).flatMap((e) => PER_ENDPOINT.map((s) => `${s}@${e.id}`))];

function expectationsFor(id) {
  return {
    exposed: [{ exposed: true, typed: true }],
    counted: [{ counted: true }],
    errors: [{ errorsCounted: true }],
    latency: [{ histogram: true, timed: true }],
    cardinality: [{ templated: true, noPii: true }],
  }[id.split("@")[0]] || [];
}

const RULES = {
  exposed: "metrics-endpoint",
  typed: "metrics-endpoint",
  counted: "request-count",
  errorsCounted: "error-count",
  histogram: "latency-histogram",
  timed: "latency-histogram",
  templated: "high-cardinality",
  noPii: "pii-in-labels",
};
const ruleFor = (id, fact) => RULES[fact] || "metrics-endpoint";

module.exports = { MAX_ENDPOINTS, PER_ENDPOINT, requiredScenarios, expectationsFor, ruleFor };
