"use strict";

/**
 * Reconciliador transaccional: lleva el repo del estado actual al deseado.
 *
 * Flujo:
 *   1. discover() clasifica cada artefacto (inventory.js).
 *   2. Se construye un plan; en dry-run se devuelve sin tocar nada.
 *   3. Se abre una transacción, se aplican las operaciones y se corre un
 *      self-check.
 *   4. Sólo si todo pasa se persiste el inventario y se confirma. Ante
 *      cualquier fallo se hace rollback y se devuelve evidencia.
 *
 * Un artefacto en CONFLICT no se sobrescribe: se deja una propuesta
 * `.kiritek-new` y se reporta para resolución explícita.
 *
 * (Requisitos 21.1–21.9, 4.6, 26.2–26.3, G.2, G.13.)
 */

const fs = require("fs");
const path = require("path");

const inventory = require("./inventory.js");
const merge = require("./merge.js");
const { createTransaction } = require("./transaction.js");

const { OPERATION, STRATEGY, INVENTORY_FILENAME } = inventory;

/**
 * Construye el plan sin mutar.
 * @param {string} repoRoot
 * @param {object[]} desired  Artefactos deseados con contenido: cada uno debe
 *                            incluir `content` (string) además de los campos de
 *                            desiredArtifact.
 * @returns {{ discovery, plan }}
 */
function buildPlan(repoRoot, desired) {
  const discovery = inventory.discover(repoRoot, desired);
  const byPath = new Map(desired.map((d) => [d.path, d]));
  const plan = discovery.items.map((item) => ({
    ...item,
    hasContent: typeof byPath.get(item.path)?.content === "string",
  }));
  return { discovery, plan, byPath };
}

/**
 * Aplica el plan de forma transaccional.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object[]} opts.desired   Artefactos con `content`.
 * @param {boolean} [opts.dryRun]
 * @param {(touched: string[]) => void} [opts.selfCheck]  Lanza si algo quedó mal.
 * @param {() => void} [opts.faultInjector]  Para pruebas: lanza en medio del apply.
 * @returns {object} resultado con plan, operaciones, conflictos y estado.
 */
function reconcile(opts) {
  const { repoRoot, desired } = opts;
  if (typeof repoRoot !== "string") throw new TypeError("reconcile.repoRoot requerido");
  const dryRun = !!opts.dryRun;

  const { plan, byPath } = buildPlan(repoRoot, desired);
  const conflicts = plan.filter((p) => p.operation === OPERATION.CONFLICT);
  const proposals = [];

  if (dryRun) {
    return {
      dryRun: true,
      applied: false,
      plan,
      conflicts: conflicts.map((c) => c.path),
      summary: summarize(plan),
    };
  }

  const tx = createTransaction(repoRoot);
  const inv = inventory.readInventory(repoRoot);
  const newEntries = { ...inv.entries };

  try {
    let fired = false;
    for (const item of plan) {
      const artifact = byPath.get(item.path);

      switch (item.operation) {
        case OPERATION.CREATE:
        case OPERATION.REPLACE: {
          // Un artefacto managed-block que aún no existe NO debe escribirse como
          // contenido crudo: debe nacer ya como bloque administrado, para que la
          // segunda corrida (que lo verá como MERGE) sea byte-idéntica. De lo
          // contrario la primera instalación y la reinstalación divergen.
          if (artifact.strategy === STRATEGY.MANAGED_BLOCK) {
            const entries = String(artifact.content)
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            const merged = merge.mergeManagedBlock("", entries);
            tx.writeFile(item.path, merged.content);
            newEntries[item.path] = {
              owner: artifact.owner,
              strategy: STRATEGY.MANAGED_BLOCK,
              installedHash: inventory.sha256(Buffer.from(merged.content)),
              version: artifact.version || null,
            };
            break;
          }
          tx.writeFile(item.path, artifact.content, artifact.executable ? { mode: 0o755 } : undefined);
          newEntries[item.path] = {
            owner: artifact.owner,
            strategy: artifact.strategy,
            installedHash: inventory.sha256(Buffer.from(artifact.content)),
            version: artifact.version || null,
          };
          break;
        }
        case OPERATION.MERGE: {
          const abs = path.join(repoRoot, item.path);
          const original = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
          const entries = String(artifact.content).split("\n").map((s) => s.trim()).filter(Boolean);
          const merged = merge.mergeManagedBlock(original, entries);
          if (merged.changed) tx.writeFile(item.path, merged.content);
          newEntries[item.path] = {
            owner: artifact.owner,
            strategy: STRATEGY.MANAGED_BLOCK,
            installedHash: inventory.sha256(Buffer.from(merged.content)),
            version: artifact.version || null,
          };
          break;
        }
        case OPERATION.CONFLICT: {
          // No sobrescribir: dejar propuesta junto al original.
          const proposal = merge.proposalPath(item.path);
          tx.writeFile(proposal, artifact.content);
          proposals.push(proposal);
          break;
        }
        case OPERATION.NOOP:
        default:
          break;
      }

      // Punto de inyección de fallo para pruebas de rollback.
      if (!fired && typeof opts.faultInjector === "function") {
        fired = true;
        opts.faultInjector();
      }
    }

    // Self-check antes de confirmar.
    if (typeof opts.selfCheck === "function") {
      opts.selfCheck(tx.touched);
    }

    // Persistir inventario SÓLO ahora (dentro de la transacción).
    const invContent = JSON.stringify({ schemaVersion: inventory.SCHEMA_VERSION, entries: newEntries }, null, 2) + "\n";
    tx.writeFile(INVENTORY_FILENAME, invContent);

    tx.commit();
    return {
      dryRun: false,
      applied: true,
      plan,
      conflicts: conflicts.map((c) => c.path),
      proposals,
      summary: summarize(plan),
    };
  } catch (err) {
    const { restored } = tx.rollback();
    return {
      dryRun: false,
      applied: false,
      rolledBack: true,
      restored,
      error: err.message,
      conflicts: conflicts.map((c) => c.path),
    };
  }
}

function summarize(plan) {
  const s = { create: 0, replace: 0, merge: 0, conflict: 0, remove: 0, noop: 0 };
  for (const p of plan) s[p.operation] += 1;
  return s;
}

module.exports = { buildPlan, reconcile, summarize };
