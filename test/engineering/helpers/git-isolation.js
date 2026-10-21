"use strict";

// Config global de Git vacía para los repos temporales de los tests. Un
// archivo vacío y no `os.devNull`: en Windows `\\.\nul` no es una ruta que Git
// pueda abrir como config (`unable to access '\\.\nul'`).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EMPTY_GIT_CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-gitcfg-")), "gitconfig");
fs.writeFileSync(EMPTY_GIT_CONFIG, "");

/** Aísla el proceso de la config de sistema y global del usuario. */
function isolateGit(env = process.env) {
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG;
  return env;
}

module.exports = { EMPTY_GIT_CONFIG, isolateGit };
