"use strict";

/**
 * Generador del registro de evidencia de la ejecución de aceptación (tarea 44).
 *
 * Produce un registro reproducible por corrida con: hash de commit, hash de la
 * configuración/árbol de pruebas, plataforma, comando, timestamp y exit code.
 * Reutiliza el contrato de `src/domain/evidence.js` para que la forma sea la
 * misma que el resto de la evidencia del core.
 *
 * El registro es **específico de la máquina/instante**, así que se escribe en
 * la colección IGNORADA `test/.acceptance-evidence/` (ver `.gitignore`). El
 * índice committeado (`templates/core/security/docs/EVIDENCE-INDEX.md`) es el
 * contrato de cobertura; este archivo sólo deja constancia de UNA corrida.
 *
 * No contiene secretos: sólo metadatos de ejecución.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const { createEvidence } = require("../../src/domain/evidence.js");

const PKG_ROOT = path.join(__dirname, "..", "..");
const EVIDENCE_DIR = path.join(PKG_ROOT, "test", ".acceptance-evidence");

/** Hash estable del árbol de pruebas (sirve como "config hash" del alcance). */
function hashTestTree() {
  const h = crypto.createHash("sha256");
  const roots = [path.join(PKG_ROOT, "test")];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".acceptance-evidence") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(abs);
    }
  }
  for (const r of roots) walk(r);
  for (const f of files) {
    h.update(path.relative(PKG_ROOT, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex");
}

/** Commit actual, o 'uncommitted' si no hay repo/commit. */
function currentCommit() {
  const r = spawnSync("git", ["-C", PKG_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (r.status === 0 && typeof r.stdout === "string" && r.stdout.trim()) {
    return r.stdout.trim();
  }
  return "uncommitted";
}

/**
 * Construye el registro de evidencia de aceptación.
 *
 * @param {object} [opts]
 * @param {number} [opts.exitCode=0] Exit code de la suite.
 * @param {string} [opts.decision="allow"] Decisión asociada.
 * @param {() => string} [opts.clock] Fuente de timestamp (para tests).
 * @param {() => string} [opts.idGenerator] Fuente de id (para tests).
 */
function buildRecord(opts = {}) {
  const platform = `${process.platform} ${os.release()} ${process.arch}`;
  return createEvidence(
    {
      control: "task-44-acceptance",
      command: "node --test",
      toolVersion: `node ${process.version}`,
      configHash: hashTestTree(),
      commit: currentCommit(),
      scope: "G.1-G.15",
      exitCode: Number.isInteger(opts.exitCode) ? opts.exitCode : 0,
      decision: opts.decision || "allow",
    },
    { clock: opts.clock, idGenerator: opts.idGenerator }
  );
}

/**
 * Escribe el registro en la colección ignorada y devuelve {record, file}.
 * `platform` se adjunta aparte del contrato de evidencia (que no la modela).
 */
function writeRecord(opts = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = buildRecord(opts);
  const payload = {
    ...record,
    platform: `${process.platform} ${os.release()} ${process.arch}`,
  };
  const file = path.join(EVIDENCE_DIR, `acceptance-${record.id}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { record: payload, file };
}

module.exports = {
  EVIDENCE_DIR,
  hashTestTree,
  currentCommit,
  buildRecord,
  writeRecord,
};
