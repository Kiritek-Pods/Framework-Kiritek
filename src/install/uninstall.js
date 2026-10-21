"use strict";

/**
 * Desinstalación selectiva de artefactos Kiritek.
 *
 * Reglas (requisito 4.7 / 8.4):
 *  - Sólo se tocan artefactos registrados en el inventario como ownership
 *    Kiritek. Archivos del usuario y hooks preexistentes no se tocan.
 *  - Artefactos `owned`/`generated` se eliminan si el disco coincide con lo que
 *    Kiritek instaló; si el usuario los personalizó (drift), se conservan y se
 *    reportan para decisión manual.
 *  - Artefactos `managed-block` no se borran: se retira sólo el bloque Kiritek,
 *    preservando el contenido del usuario.
 *  - Todo ocurre dentro de una transacción con rollback.
 */

const fs = require("fs");
const path = require("path");

const inventory = require("./inventory.js");
const merge = require("./merge.js");
const { createTransaction } = require("./transaction.js");

const { STRATEGY, INVENTORY_FILENAME } = inventory;

/**
 * Quita el bloque administrado de un texto, dejando el resto intacto.
 */
function stripManagedBlock(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const begin = lines.indexOf(merge.BEGIN);
  const end = lines.indexOf(merge.END);
  if (begin === -1 || end === -1 || end < begin) return { content: text, changed: false };
  const out = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  const content = out.join("\n") + (out.length ? "\n" : "");
  return { content, changed: true };
}

/**
 * @param {object} opts { repoRoot, dryRun }
 * @returns {object} resultado con removed, preserved(drift), blocksStripped, kept.
 */
function uninstall(opts) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string") throw new TypeError("uninstall.repoRoot requerido");
  const dryRun = !!opts.dryRun;

  const inv = inventory.readInventory(repoRoot);
  const removed = [];
  const preservedDrift = [];
  const blocksStripped = [];
  const kept = [];

  const plan = [];
  for (const [relPath, entry] of Object.entries(inv.entries)) {
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
      dryRun: true,
      applied: false,
      wouldRemove: plan.filter((p) => p.action === "remove").map((p) => p.relPath),
      wouldStrip: plan.filter((p) => p.action === "strip").map((p) => p.relPath),
      preservedDrift,
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
    // Mantener en inventario sólo lo que no se desinstaló (drift conservado).
    for (const p of preservedDrift) remainingEntries[p] = inv.entries[p];

    const invContent =
      JSON.stringify({ schemaVersion: inventory.SCHEMA_VERSION, entries: remainingEntries }, null, 2) + "\n";
    tx.writeFile(INVENTORY_FILENAME, invContent);
    tx.commit();
    return { dryRun: false, applied: true, removed, blocksStripped, preservedDrift, kept };
  } catch (err) {
    const { restored } = tx.rollback();
    return { dryRun: false, applied: false, rolledBack: true, restored, error: err.message };
  }
}

module.exports = { uninstall, stripManagedBlock };
