"use strict";

/** Normalizer de `web.module-announcement`: valida facts por tipo. */

const { loadSchema, validate } = require("../../../../domain/schema-validator.js");

const VERSION = "1.0.0";
const KINDS = new Set(["announcement-manifest", "announcement-behavior", "announcement-signals", "announcement-harness-run"]);

function normalize(facts, kind) {
  if (!KINDS.has(kind)) throw Object.assign(new Error("kind"), { code: "NORMALIZATION" });
  if (kind === "announcement-behavior") {
    const schema = loadSchema("engineering/controls/web-module-announcement.trace");
    const check = validate({ id: facts.scenario, status: "ok", steps: facts.steps }, { ...schema.definitions.scenario, definitions: schema.definitions }, { extended: true });
    if (!check.valid) throw Object.assign(new Error("trace"), { code: "NORMALIZATION" });
  }
  return facts;
}

module.exports = { version: VERSION, normalize };
