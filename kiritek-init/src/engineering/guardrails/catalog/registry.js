"use strict";

/**
 * Registro local de catálogos instalados: `<root>/<semver>/catalog.json`.
 * Las raíces son el catálogo builtin distribuido con kiritek-init y la cache
 * verificada. No hay resolución remota aquí (offline-first).
 */

const fs = require("node:fs");
const path = require("node:path");
const semver = require("./semver.js");

const BUILTIN_ROOT = path.join(__dirname, "..", "..", "..", "..", "catalogs", "engineering", "guardrails");

function listVersions(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && semver.isExact(d.name) && fs.existsSync(path.join(root, d.name, "catalog.json")))
    .map((d) => d.name)
    .sort(semver.compare);
}

function versionDir(root, version) {
  if (!semver.isExact(version)) throw new TypeError(`versión no exacta: ${version}`);
  return path.join(root, version);
}

module.exports = { BUILTIN_ROOT, listVersions, versionDir };
