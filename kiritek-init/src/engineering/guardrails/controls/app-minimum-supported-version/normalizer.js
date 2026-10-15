"use strict";

/** Normalizer de `app.minimum-supported-version`: valida facts por tipo. */

const { loadSchema, validate } = require("../../../../domain/schema-validator.js");

const VERSION = "1.0.0";
const KINDS = new Set(["version-contract", "version-behavior", "version-signals", "version-harness-run"]);

function normalize(facts, kind) {
  if (!KINDS.has(kind)) throw Object.assign(new Error("kind"), { code: "NORMALIZATION" });
  if (kind === "version-behavior") {
    const schema = loadSchema("engineering/controls/app-minimum-supported-version.trace");
    const check = validate({ id: facts.scenario, status: "ok", decisions: facts.decisions }, { ...schema.definitions.scenario, definitions: schema.definitions }, { extended: true });
    if (!check.valid) throw Object.assign(new Error("trace"), { code: "NORMALIZATION" });
  }
  return facts;
}

module.exports = { version: VERSION, normalize };
