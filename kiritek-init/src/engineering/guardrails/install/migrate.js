"use strict";

/**
 * Migración/actualización reentrante del pack `engineering/guardrails` (T09.5;
 * base de T15C). Es idempotente: correrla sobre un estado ya migrado no cambia
 * nada (todas las operaciones resuelven `noop`).
 *
 * Estrategia:
 *  - Adoptar una instalación previa: si existe `kiritek-engineering.config.json`
 *    pero no está registrado en el inventario, se reinstala el baseline por
 *    reconciliación. Como la estrategia es `owned`, un archivo idéntico al de la
 *    plantilla queda `noop`; uno personalizado se marca `conflict` y se deja una
 *    propuesta `.kiritek-new` SIN sobrescribir el del usuario.
 *  - Nunca activa nuevos gates: no cambia niveles de control (eso es promoción
 *    explícita, fuera de la migración).
 *  - No toca `core/security`: delega en el `install` del pack, que sólo conoce
 *    artefactos engineering.
 *
 * Para un diff de catálogo entre versiones se reutiliza `catalog/diff.js` desde
 * el CLI (`catalog diff`); la migración de datos de catálogo mayor se cubre en
 * `catalog/migrate.js`. Aquí sólo se reconcilian los artefactos instalados.
 */

const fs = require("node:fs");
const path = require("node:path");

const { install } = require("./reconcile.js");
const { CONFIG_FILE } = require("../config/defaults.js");

/**
 * @param {object} opts { repoRoot, dryRun }
 * @returns {object} resultado de la reconciliación + señales de migración.
 */
function migrate(opts) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("migrate.repoRoot requerido");
  }

  const configPresent = fs.existsSync(path.join(repoRoot, CONFIG_FILE));
  const inventoryPresent = fs.existsSync(path.join(repoRoot, ".kiritek", "inventory.json"));
  const adoptedLegacy = configPresent && !inventoryPresent;

  const result = install({ repoRoot, dryRun: !!opts.dryRun });

  return {
    pack: "engineering/guardrails",
    adoptedLegacy,
    reconciled: true,
    ...result,
  };
}

module.exports = { migrate };
