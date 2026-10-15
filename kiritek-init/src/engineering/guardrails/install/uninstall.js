"use strict";

/**
 * Desinstalación selectiva del pack `engineering/guardrails` (T09.5).
 *
 * SÓLO toca artefactos cuyo ownership en el inventario es
 * `engineering/guardrails`. Preserva explícitamente:
 *  - artefactos `core/security` (owner `core`) y cualquier otro owner;
 *  - archivos personalizados por el usuario (drift respecto al hash instalado);
 *  - la evidencia del pack (`.kiritek/evidence/engineering/**`) y los waivers/
 *    N/A, que no son artefactos del inventario y conservan deuda/historial.
 *
 * Reutiliza la transacción compartida (`src/install/transaction.js`) para que
 * la operación sea atómica con rollback, y la semántica de estrategias del
 * inventario (owned/generated se remueven si no hay drift; managed-block pierde
 * sólo su bloque). La evidencia nunca se enumera aquí porque no vive en el
 * inventario: se preserva por defecto.
 */

const fs = require("node:fs");
const path = require("node:path");

const inventory = require("../../../install/inventory.js");
const { stripManagedBlock } = require("../../../install/uninstall.js");
const { createTransaction } = require("../../../install/transaction.js");
const { PACK_ID } = require("../contracts/common.js");

const { STRATEGY, INVENTORY_FILENAME } = inventory;

/**
 * @param {object} opts { repoRoot, dryRun }
 * @returns {object} resultado con removed/blocksStripped/preservedDrift/kept/preservedOtherOwners.
 */
function uninstall(opts) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("uninstall.repoRoot requerido");
  }
  const dryRun = !!opts.dryRun;

  const inv = inventory.readInventory(repoRoot);
  const removed = [];
  const preservedDrift = [];
  const blocksStripped = [];
  const kept = [];
  const preservedOtherOwners = [];

  const plan = [];
  for (const [relPath, entry] of Object.entries(inv.entries)) {
    // Aislamiento de dominio: lo que no es engineering NO se toca.
    if (entry.owner !== PACK_ID) {
      preservedOtherOwners.push(relPath);
      continue;
    }
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) {
      kept.push(relPath);
      continue;
    }
    if (entry.strategy === STRATEGY.MANAGED_BLOCK) {
      plan.push({ relPath, action: "strip" });
    } else if (entry.strategy === STRATEGY.OWNED || entry.strategy === STRATEGY.GENERATED) {
      let current = null;
      try {
        current = inventory.hashFile(abs);
      } catch (_) {
        current = null;
      }
      if (entry.installedHash && current && current !== entry.installedHash) {
        preservedDrift.push(relPath); // personalizado: no borrar
      } else {
        plan.push({ relPath, action: "remove" });
      }
    } else {
      kept.push(relPath); // user-owned: no se toca
    }
  }

  if (dryRun) {
    return {
      pack: PACK_ID,
      dryRun: true,
      applied: false,
      wouldRemove: plan.filter((p) => p.action === "remove").map((p) => p.relPath),
      wouldStrip: plan.filter((p) => p.action === "strip").map((p) => p.relPath),
      preservedDrift,
      preservedOtherOwners,
      kept,
    };
  }

  const tx = createTransaction(repoRoot);
  const remainingEntries = { ...inv.entries };
  try {
    for (const op of plan) {
      const abs = path.join(repoRoot, op.relPath);
      if (op.action === "remove") {
        tx.removeFile(op.relPath);
        delete remainingEntries[op.relPath];
        removed.push(op.relPath);
      } else if (op.action === "strip") {
        const text = fs.readFileSync(abs, "utf8");
        const stripped = stripManagedBlock(text);
        if (stripped.changed) tx.writeFile(op.relPath, stripped.content);
        delete remainingEntries[op.relPath];
        blocksStripped.push(op.relPath);
      }
    }
    // Conservar en inventario los otros owners y el drift engineering.
    for (const p of preservedDrift) remainingEntries[p] = inv.entries[p];

    const invContent =
      JSON.stringify({ schemaVersion: inventory.SCHEMA_VERSION, entries: remainingEntries }, null, 2) + "\n";
    tx.writeFile(INVENTORY_FILENAME, invContent);
    tx.commit();
    return {
      pack: PACK_ID,
      dryRun: false,
      applied: true,
      removed,
      blocksStripped,
      preservedDrift,
      preservedOtherOwners,
      kept,
    };
  } catch (err) {
    const { restored } = tx.rollback();
    return { pack: PACK_ID, dryRun: false, applied: false, rolledBack: true, restored, error: err.message };
  }
}

module.exports = { uninstall };
