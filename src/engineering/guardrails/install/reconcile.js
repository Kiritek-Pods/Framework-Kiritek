"use strict";

/**
 * Instalación transaccional del pack `engineering/guardrails` (T09.4, T09.5).
 *
 * Reutiliza íntegramente las primitivas compartidas de `src/install`:
 *  - `inventory` para descubrir estado y clasificar operaciones;
 *  - `reconcile` para aplicar el plan dentro de una transacción con rollback,
 *    idempotencia (segunda corrida ⇒ `noop`) y propuestas `.kiritek-new` ante
 *    conflicto (archivo owned personalizado por el usuario);
 *  - `transaction` (indirectamente) para la atomicidad.
 *
 * Garantías del pack:
 *  - NUNCA toca `kiritek-security.config.json` ni artefactos `core/security`:
 *    la lista de deseados (artifacts.js) sólo contiene rutas engineering.
 *  - La config de security puede coexistir sin ser leída ni modificada.
 *  - `--dry-run` calcula el plan sin mutar; `faultInjector` permite probar el
 *    rollback (se propaga al reconciliador compartido).
 */

const fs = require("node:fs");
const path = require("node:path");
const { reconcile } = require("../../../install/reconcile.js");
const inventory = require("../../../install/inventory.js");
const { buildDesiredArtifacts } = require("./artifacts.js");
const { CONFIG_FILE } = require("../config/defaults.js");

const SECURITY_CONFIG = "kiritek-security.config.json";

/**
 * Instala/actualiza el pack engineering de forma idempotente y transaccional.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {boolean} [opts.dryRun]
 * @param {() => void} [opts.faultInjector]  Inyección de fallo (pruebas de rollback).
 * @returns {object} resultado del reconciliador + metadatos del pack.
 */
function install(opts) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("install.repoRoot requerido");
  }
  // Una config engineering que ya existe y Kiritek no instaló es del usuario:
  // nunca se reemplaza por la plantilla (se conserva tal cual).
  const recorded = inventory.readInventory(repoRoot).entries;
  const desired = buildDesiredArtifacts().map((a) =>
    a.path === CONFIG_FILE && !recorded[CONFIG_FILE] && fs.existsSync(path.join(repoRoot, CONFIG_FILE)) ? { ...a, strategy: inventory.STRATEGY.USER_OWNED } : a
  );

  // Invariante defensivo: ningún artefacto engineering puede apuntar a la
  // config de security. Si alguna vez se introdujera, abortamos antes de mutar.
  for (const a of desired) {
    if (a.path === SECURITY_CONFIG || a.path.startsWith("core/security")) {
      throw new Error(`artefacto engineering inválido: no puede tocar ${a.path}`);
    }
  }

  const result = reconcile({
    repoRoot,
    desired,
    dryRun: !!opts.dryRun,
    faultInjector: opts.faultInjector,
  });

  return {
    pack: "engineering/guardrails",
    installed: result.applied === true,
    ...result,
  };
}

module.exports = { install, SECURITY_CONFIG };
