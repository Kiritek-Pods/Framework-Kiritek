"use strict";

/**
 * Motor transaccional de cambios en el sistema de archivos.
 *
 * Objetivo: que una instalación/actualización sea atómica o recuperable. Antes
 * de mutar, se toma un snapshot del estado previo de cada archivo afectado. Las
 * escrituras van a temporales y se promueven con rename. Si cualquier paso
 * falla (incluido un fallo inyectado o un self-check), se restaura el snapshot y
 * se devuelve evidencia del rollback.
 *
 * No persiste nada "a medias": el commit del inventario lo hace el llamador
 * SÓLO después de que la transacción confirma éxito.
 *
 * (Requisitos 4.6, 21.1–21.9, 26.2.)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Crea una transacción ligada a un repo.
 */
function createTransaction(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("createTransaction.repoRoot requerido");
  }
  const absRoot = path.resolve(repoRoot);

  // snapshot: relPath -> { existed, content|null }
  const snapshots = new Map();
  const applied = []; // relPaths tocados, en orden
  let committed = false;
  let rolledBack = false;

  function resolveSafe(relPath) {
    const abs = path.resolve(absRoot, relPath);
    const rel = path.relative(absRoot, abs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`ruta fuera del repositorio: ${relPath}`);
    }
    return abs;
  }

  function snapshot(relPath) {
    if (snapshots.has(relPath)) return;
    const abs = resolveSafe(relPath);
    if (fs.existsSync(abs)) {
      snapshots.set(relPath, { existed: true, content: fs.readFileSync(abs) });
    } else {
      snapshots.set(relPath, { existed: false, content: null });
    }
  }

  /**
   * Escribe contenido en relPath de forma atómica, tras snapshotear el estado
   * previo. No persiste inventario; sólo toca el archivo.
   */
  function writeFile(relPath, content, { mode = 0o644 } = {}) {
    if (committed || rolledBack) throw new Error("transacción ya finalizada");
    snapshot(relPath);
    const abs = resolveSafe(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, content, { mode });
    fs.renameSync(tmp, abs);
    if (!applied.includes(relPath)) applied.push(relPath);
  }

  /**
   * Elimina un archivo, snapshoteando su contenido para poder restaurarlo.
   */
  function removeFile(relPath) {
    if (committed || rolledBack) throw new Error("transacción ya finalizada");
    snapshot(relPath);
    const abs = resolveSafe(relPath);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    if (!applied.includes(relPath)) applied.push(relPath);
  }

  /**
   * Restaura todos los archivos tocados a su estado previo al snapshot.
   * @returns {{ restored: string[] }}
   */
  function rollback() {
    if (committed) throw new Error("no se puede hacer rollback de una transacción confirmada");
    const restored = [];
    // Restaurar en orden inverso al aplicado.
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const relPath = applied[i];
      const snap = snapshots.get(relPath);
      const abs = resolveSafe(relPath);
      if (!snap) continue;
      if (snap.existed) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, snap.content);
      } else if (fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
      }
      restored.push(relPath);
    }
    rolledBack = true;
    return { restored };
  }

  function commit() {
    if (rolledBack) throw new Error("no se puede confirmar una transacción con rollback");
    committed = true;
    return { applied: [...applied] };
  }

  return {
    writeFile,
    removeFile,
    snapshot,
    rollback,
    commit,
    get touched() {
      return [...applied];
    },
    get isCommitted() {
      return committed;
    },
    get isRolledBack() {
      return rolledBack;
    },
  };
}

module.exports = { createTransaction };
