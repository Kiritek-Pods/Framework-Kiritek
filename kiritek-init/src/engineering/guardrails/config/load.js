"use strict";

/**
 * Lectura de `kiritek-engineering.config.json`. No lee nunca
 * `kiritek-security.config.json`: los dominios no comparten configuración.
 */

const fs = require("node:fs");
const path = require("node:path");
const { raise } = require("../errors.js");
const { CONFIG_FILE } = require("./defaults.js");

const MAX_CONFIG_BYTES = 512 * 1024;

function parseConfigText(text, sourceRef = CONFIG_FILE) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const m = /position (\d+)/.exec(err.message);
    let where = "";
    if (m) {
      const before = text.slice(0, Number(m[1]));
      const line = before.split("\n").length;
      where = ` (línea ${line})`;
    }
    raise("CONFIG_PARSE", `JSON inválido en ${sourceRef}${where}`, {
      pointer: sourceRef,
      remediation: "Corrija la sintaxis JSON; no se usan defaults ocultos ante config inválida.",
    });
  }
}

/**
 * @returns {{present: false} | {present: true, document: object, sourceRef: string}}
 */
function loadConfigFile(repoRoot) {
  const file = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) return { present: false };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    raise("CONFIG_UNSAFE_FILE", `${CONFIG_FILE} es un symlink; no se sigue`, { pointer: CONFIG_FILE });
  }
  if (stat.size > MAX_CONFIG_BYTES) raise("CONFIG_UNSAFE_FILE", `${CONFIG_FILE} excede ${MAX_CONFIG_BYTES} bytes`);
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  return { present: true, document: parseConfigText(text), sourceRef: CONFIG_FILE };
}

module.exports = { MAX_CONFIG_BYTES, parseConfigText, loadConfigFile };
