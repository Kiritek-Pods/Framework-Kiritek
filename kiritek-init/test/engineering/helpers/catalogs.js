"use strict";

// Construye catálogos temporales (copias del builtin con mutaciones) con el
// digest recalculado, para probar resolución, cache, diff y conformidad.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BUILTIN_ROOT } = require("../../../src/engineering/guardrails/catalog/registry.js");
const { readCatalogDir } = require("../../../src/engineering/guardrails/catalog/load.js");
const { computeCatalogDigest } = require("../../../src/engineering/guardrails/catalog/verify.js");

const BUILTIN_VERSION = "1.0.0";

function builtinFiles(version = BUILTIN_VERSION) {
  return readCatalogDir(path.join(BUILTIN_ROOT, version));
}

function builtinDoc(version = BUILTIN_VERSION) {
  return JSON.parse(builtinFiles(version)["catalog.json"].toString("utf8"));
}

/** Aplica `mutate(doc, files)` y devuelve un mapa de archivos con digest válido. */
function buildFiles(mutate = () => {}, { base = BUILTIN_VERSION, sign } = {}) {
  const files = { ...builtinFiles(base) };
  const doc = JSON.parse(files["catalog.json"].toString("utf8"));
  mutate(doc, files);
  doc.digest = computeCatalogDigest(doc, files);
  if (sign) files[doc.signature.signatureRef] = sign(doc.digest);
  files["catalog.json"] = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
  return files;
}

function tmpDir(prefix = "kiritek-eng-cat-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Escribe archivos en `<root>/<version>/` y devuelve root. */
function writeCatalog(root, files) {
  const doc = JSON.parse(files["catalog.json"].toString("utf8"));
  const dir = path.join(root, doc.version);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function docOf(files) {
  return JSON.parse(files["catalog.json"].toString("utf8"));
}

module.exports = { BUILTIN_VERSION, builtinFiles, builtinDoc, buildFiles, tmpDir, writeCatalog, docOf };
