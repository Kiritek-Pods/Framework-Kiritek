"use strict";

/**
 * Backups del lifecycle engineering (T15C.1–T15C.2, R22.4). Antes de mutar,
 * se copia cada archivo que la operación puede tocar (contenido, modo y si
 * existía) a `.kiritek/backups/engineering/<stamp>/`; ante cualquier fallo se
 * restaura todo y se VERIFICA la restauración por hash. Cubre lo que la
 * transacción del inventario no ve: hooks Git, settings de asistentes,
 * workflows y la config del usuario.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BACKUPS_DIR = ".kiritek/backups/engineering";
const KEEP = 5;

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * @param {string} repoRoot
 * @param {string[]} targets  Rutas absolutas o relativas al repo.
 * @param {{stamp: string}} opts
 * @returns {{ref: string, entries: object[]}}
 */
function createBackup(repoRoot, targets, { stamp }) {
  const ref = `${BACKUPS_DIR}/${stamp.replace(/[^0-9A-Za-z]/g, "")}`;
  const absRef = path.join(repoRoot, ...ref.split("/"));
  fs.mkdirSync(path.join(absRef, "files"), { recursive: true });
  const entries = [];
  [...new Set(targets.map((t) => path.resolve(repoRoot, t)))].sort().forEach((abs, i) => {
    let st = null;
    try {
      st = fs.lstatSync(abs);
    } catch (_) {
      st = null;
    }
    if (st && !st.isFile()) return; // directorios/symlinks no se respaldan ni se tocan
    // Ruta relativa al repo (nunca absoluta en artefactos; los hooks de un
    // worktree pueden quedar fuera del repo: se guardan como "../…").
    const entry = { target: path.relative(repoRoot, abs).split(path.sep).join("/"), existed: !!st };
    if (st) {
      const content = fs.readFileSync(abs);
      fs.writeFileSync(path.join(absRef, "files", String(i)), content);
      Object.assign(entry, { blob: String(i), mode: st.mode & 0o777, sha256: sha(content) });
    }
    entries.push(entry);
  });
  fs.writeFileSync(path.join(absRef, "manifest.json"), JSON.stringify({ schemaVersion: 1, stamp, entries }, null, 2));
  return { ref, entries };
}

/** Restaura y verifica. @returns {{restored: number, verified: boolean, mismatches: string[]}} */
function restoreBackup(repoRoot, ref) {
  const absRef = path.join(repoRoot, ...ref.split("/"));
  const { entries } = JSON.parse(fs.readFileSync(path.join(absRef, "manifest.json"), "utf8"));
  let restored = 0;
  const abs = (e) => path.resolve(repoRoot, ...e.target.split("/"));
  for (const e of entries) {
    if (e.existed) {
      fs.mkdirSync(path.dirname(abs(e)), { recursive: true });
      fs.writeFileSync(abs(e), fs.readFileSync(path.join(absRef, "files", e.blob)));
      fs.chmodSync(abs(e), e.mode);
    } else {
      fs.rmSync(abs(e), { force: true });
    }
    restored += 1;
  }
  const mismatches = entries.filter((e) => (e.existed ? !fs.existsSync(abs(e)) || sha(fs.readFileSync(abs(e))) !== e.sha256 || (fs.statSync(abs(e)).mode & 0o777) !== e.mode : fs.existsSync(abs(e)))).map((e) => e.target);
  return { restored, verified: mismatches.length === 0, mismatches };
}

/** Conserva los últimos KEEP backups. */
function pruneBackups(repoRoot, keep = KEEP) {
  const dir = path.join(repoRoot, ...BACKUPS_DIR.split("/"));
  if (!fs.existsSync(dir)) return 0;
  const all = fs.readdirSync(dir).sort();
  const drop = all.slice(0, Math.max(0, all.length - keep));
  for (const d of drop) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  return drop.length;
}

module.exports = { BACKUPS_DIR, createBackup, restoreBackup, pruneBackups };
