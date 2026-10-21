"use strict";

// Carga fixtures de contratos engineering como copias profundas mutables.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "fixtures", "contracts");

function load(kind, name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, kind, `${name}.json`), "utf8"));
}

const valid = (name) => load("valid", name);
const invalid = (name) => load("invalid", name);

function listNames(kind) {
  return fs
    .readdirSync(path.join(ROOT, kind))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/** Envelope base sin el campo derivado, listo para `createResultEnvelope`. */
function envelopeInput(name = "envelope.deny-eligible") {
  const e = valid(name);
  delete e.blockingEligible;
  return e;
}

module.exports = { ROOT, valid, invalid, listNames, envelopeInput };
