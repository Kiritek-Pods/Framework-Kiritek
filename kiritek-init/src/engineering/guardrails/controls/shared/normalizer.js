"use strict";

/**
 * Normalizer común: valida que el kind sea del control y, para observaciones
 * conductuales, que los pasos cumplan el schema de traza del control.
 */

const { loadSchema, validate } = require("../../../../domain/schema-validator.js");

function makeNormalizer({ version = "1.0.0", kinds, behaviorKind, traceSchema }) {
  const KINDS = new Set(kinds);
  return {
    version,
    normalize(facts, kind) {
      if (!KINDS.has(kind)) throw Object.assign(new Error("kind"), { code: "NORMALIZATION" });
      if (kind === behaviorKind) {
        const schema = loadSchema(traceSchema);
        const check = validate({ id: facts.scenario, status: "ok", steps: facts.steps }, { ...schema.definitions.scenario, definitions: schema.definitions }, { extended: true });
        if (!check.valid) throw Object.assign(new Error("trace"), { code: "NORMALIZATION" });
      }
      return facts;
    },
  };
}

module.exports = { makeNormalizer };
