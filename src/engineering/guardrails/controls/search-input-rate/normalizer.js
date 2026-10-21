"use strict";

/** Normalizer de `search.input-rate`: valida la forma de facts por tipo (T10.2). */

const { loadSchema, validate } = require("../../../../domain/schema-validator.js");

const VERSION = "1.0.0";
const KINDS = new Set(["search-contract", "search-behavior", "search-signals", "search-harness-run"]);

function normalize(facts, kind) {
  if (!KINDS.has(kind)) throw Object.assign(new Error("kind"), { code: "NORMALIZATION" });
  if (kind === "search-behavior") {
    const traceSchema = loadSchema("engineering/controls/search-input-rate.trace");
    const scenario = { id: facts.scenario, status: "ok", events: facts.events };
    const check = validate(scenario, { ...traceSchema.definitions.scenario, definitions: traceSchema.definitions }, { extended: true });
    if (!check.valid) throw Object.assign(new Error("trace"), { code: "NORMALIZATION" });
    const seqs = facts.events.map((e) => e.seq);
    if (seqs.some((s, i) => i > 0 && s <= seqs[i - 1])) throw Object.assign(new Error("orden"), { code: "NORMALIZATION" });
  }
  return facts;
}

module.exports = { version: VERSION, normalize };
