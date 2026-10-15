#!/usr/bin/env node
"use strict";

/**
 * Construye el candidato de catálogo 2.0.0 (T17.7) a partir del 1.0.0
 * publicado: mismos controles, `enforce` soportado y `enforcementContract`
 * ligado a la suite R27 de cada control. Reproducible: mismo input, mismo
 * digest. Las notas (`notes/`) se mantienen a mano en el candidato.
 *
 *   node scripts/build-catalog-candidate.js [--check]
 *
 * `--check` no escribe: falla (exit 1) si el candidato en disco difiere.
 */

const fs = require("node:fs");
const path = require("node:path");
const { readCatalogDir } = require("../src/engineering/guardrails/catalog/load.js");
const { computeCatalogDigest } = require("../src/engineering/guardrails/catalog/verify.js");
const { SUITES } = require("../src/engineering/guardrails/conformance/registry.js");

const ROOT = path.join(__dirname, "..");
const BASE = path.join(ROOT, "catalogs", "engineering", "guardrails", "1.0.0");
const CANDIDATE = path.join(ROOT, "release", "candidates", "engineering", "guardrails", "2.0.0");
const VERSION = "2.0.0";
const PUBLISHED_AT = "2026-10-13T00:00:00Z";
const MIGRATION_REF = "notes/MIGRATION-1.0.0-to-2.0.0.md";

function buildCandidate() {
  const base = readCatalogDir(BASE);
  const current = readCatalogDir(CANDIDATE);
  const files = { ...base };
  // Notas propias del candidato (changelog, migración); parámetros desde la base.
  for (const [rel, buf] of Object.entries(current)) if (rel.startsWith("notes/")) files[rel] = buf;
  const doc = JSON.parse(base["catalog.json"].toString("utf8"));
  doc.version = VERSION;
  doc.publishedAt = PUBLISHED_AT;
  doc.migrations = [{ from: "1.0.0", to: VERSION, ref: MIGRATION_REF }];
  for (const ctl of doc.controls) {
    const suite = SUITES[ctl.id];
    if (!suite) throw new Error(`control sin suite R27: ${ctl.id}`);
    ctl.supportedLevels = ["off", "warn", "enforce"];
    ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: suite.id, approvedVersion: suite.version, moments: ["pr", "release"] };
  }
  doc.digest = computeCatalogDigest(doc, files);
  files["catalog.json"] = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
  return { doc, files };
}

if (require.main === module) {
  const { doc, files } = buildCandidate();
  if (process.argv.includes("--check")) {
    const disk = readCatalogDir(CANDIDATE);
    const same = Object.keys(files).length === Object.keys(disk).length && Object.entries(files).every(([rel, buf]) => disk[rel] && disk[rel].equals(buf));
    process.stdout.write(`${same ? "ok" : "DIFIERE"} ${doc.version} ${doc.digest}\n`);
    process.exit(same ? 0 : 1);
  }
  for (const [rel, buf] of Object.entries(files)) {
    const target = path.join(CANDIDATE, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }
  process.stdout.write(`${doc.version} ${doc.digest}\n`);
}

module.exports = { buildCandidate, CANDIDATE, VERSION };
