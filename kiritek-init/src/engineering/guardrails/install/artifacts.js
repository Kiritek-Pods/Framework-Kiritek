"use strict";

/**
 * Artefactos deseados del pack `engineering/guardrails` (T09.4).
 *
 * El pack es independiente de `core/security`: todos sus artefactos declaran
 * ownership `engineering/guardrails` y NUNCA incluyen `kiritek-security.config.json`
 * ni ningún artefacto bajo `core/security`. Se instalan reutilizando el
 * inventario/reconciliador/transacción compartidos (`src/install/*`).
 *
 * Artefactos:
 *  - `kiritek-engineering.config.json` (owned): config del pack desde plantilla.
 *  - `.kiritek/.gitignore` (owned): `.gitignore` ANIDADO que ignora la cache y
 *    la evidencia del pack (rutas relativas a `.kiritek/`). Se usa un archivo
 *    propio en vez del `.gitignore` raíz para no compartir el bloque
 *    administrado de `core/security` (mismo marcador): así instalar/desinstalar
 *    engineering nunca altera artefactos de security. Security no crea este
 *    archivo, de modo que es seguro declararlo engineering-owned.
 *  - `.kiritek/engineering/README.md` (generated): nota de propiedad del pack
 *    para que las carpetas de evidencia/waivers existan y sean reconocibles.
 *
 * Nada aquí descarga red ni ejecuta herramientas: sólo material estático.
 */

const fs = require("node:fs");
const path = require("node:path");

const inventory = require("../../../install/inventory.js");
const { PACK_ID } = require("../contracts/common.js");
const { CONFIG_FILE } = require("../config/defaults.js");

const TEMPLATES_DIR = path.join(__dirname, "..", "..", "..", "..", "templates", "engineering", "guardrails");

/**
 * Entradas de ignore del pack. Viven en un `.gitignore` ANIDADO en `.kiritek/`
 * (rutas relativas a ese directorio), de modo que no tocan el `.gitignore` raíz
 * ni el bloque administrado de core/security.
 */
const IGNORE_ENTRIES = Object.freeze(["cache/engineering/", "evidence/engineering/", "telemetry/engineering/", "tmp/"]);

const ENGINEERING_GITIGNORE = [
  "# engineering/guardrails (Kiritek) — cache, evidencia, telemetría local y temporales del pack",
  ...IGNORE_ENTRIES,
  "",
].join("\n");

const ENGINEERING_README = [
  "# engineering/guardrails",
  "",
  "Artefactos del pack Kiritek `engineering/guardrails` (independiente de core/security).",
  "Este directorio contiene cache, evidencia, waivers y declaraciones N/A del pack.",
  "Desinstalar el pack (`kiritek-init guardrails uninstall`) sólo remueve artefactos",
  "propiedad de engineering; la evidencia y lo personalizado por el usuario se preservan.",
  "",
].join("\n");

function readTemplate(rel) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, rel), "utf8");
}

/**
 * Construye la lista de artefactos deseados del pack engineering, cada uno con
 * `content` y ownership `engineering/guardrails`.
 *
 * @returns {object[]}
 */
function buildDesiredArtifacts() {
  const configContent = readTemplate(path.join("config", CONFIG_FILE));

  const mk = (p, content, strategy, extra = {}) => ({
    ...inventory.desiredArtifact({
      path: p,
      strategy,
      distHash: inventory.sha256(Buffer.from(content)),
      owner: PACK_ID,
    }),
    content,
    ...extra,
  });

  return [
    mk(CONFIG_FILE, configContent, inventory.STRATEGY.OWNED, { gitDependent: false }),
    mk(".kiritek/.gitignore", ENGINEERING_GITIGNORE, inventory.STRATEGY.OWNED, { gitDependent: true }),
    mk(".kiritek/engineering/README.md", ENGINEERING_README, inventory.STRATEGY.GENERATED, { gitDependent: false }),
  ];
}

module.exports = { TEMPLATES_DIR, IGNORE_ENTRIES, buildDesiredArtifacts };
