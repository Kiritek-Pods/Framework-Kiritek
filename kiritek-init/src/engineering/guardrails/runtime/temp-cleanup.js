"use strict";

/**
 * Directorios temporales con limpieza garantizada (T07.1).
 *
 * Cada ejecución de herramienta recibe su propio temporal (TMPDIR/TEMP/TMP)
 * fuera del repo. Se borran en `finally` y, como red de seguridad, al salir
 * el proceso o recibir SIGINT/SIGTERM.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const active = new Set();
let hooked = false;

function cleanupAll() {
  for (const dir of active) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* mejor esfuerzo */
    }
    active.delete(dir);
  }
}

function hookProcess() {
  if (hooked) return;
  hooked = true;
  process.once("exit", cleanupAll);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    // No se secuestran señales si el proceso anfitrión ya las gestiona.
    if (process.listenerCount(sig) > 0) continue;
    process.once(sig, () => {
      cleanupAll();
      process.kill(process.pid, sig);
    });
  }
}

/** @returns {{dir: string, cleanup: () => boolean}} */
function createTempWorkspace(prefix = "kiritek-eng-run-") {
  hookProcess();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  active.add(dir);
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
      active.delete(dir);
      return !fs.existsSync(dir);
    },
  };
}

async function withTempWorkspace(fn, prefix) {
  const ws = createTempWorkspace(prefix);
  try {
    return await fn(ws.dir);
  } finally {
    ws.cleanup();
  }
}

function activeTempDirs() {
  return [...active];
}

module.exports = { createTempWorkspace, withTempWorkspace, activeTempDirs, cleanupAll };
