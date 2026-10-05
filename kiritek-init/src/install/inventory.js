"use strict";

/**
 * Inventario de artefactos administrados y descubrimiento de estado.
 *
 * El instalador legacy sólo copiaba "si no existe". Esto es insuficiente para
 * seguridad: necesitamos saber qué instaló Kiritek, en qué versión, si el
 * usuario lo personalizó (drift) y qué operación corresponde en el próximo
 * `init`/`update`, SIN mutar nada durante el descubrimiento.
 *
 * Conceptos:
 *  - Un `desiredArtifact` describe lo que el pack quiere instalar: ruta
 *    relativa, ownership, estrategia y hash de la distribución.
 *  - El `inventory` persistido registra lo instalado por Kiritek y su hash en
 *    el momento de instalar, para detectar personalizaciones posteriores.
 *  - `discover()` compara deseado vs. estado real del disco y clasifica cada
 *    ruta en una operación.
 *
 * (Requisitos 4.1, 4.3, 14.6, 21.1–21.10, 23.5–23.6, G.2, G.11, G.13.)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const INVENTORY_FILENAME = ".kiritek/inventory.json";
const SCHEMA_VERSION = 1;

/** Estrategias de propiedad de un artefacto. */
const STRATEGY = Object.freeze({
  OWNED: "owned", // Kiritek lo posee por completo; se reemplaza en update.
  MANAGED_BLOCK: "managed-block", // Kiritek administra un bloque dentro de un archivo compartido.
  GENERATED: "generated", // generado una vez; no se re-genera si el usuario lo tocó.
  USER_OWNED: "user-owned", // el usuario lo posee; Kiritek sólo propone.
});

/** Operaciones que el reconciliador podría aplicar. */
const OPERATION = Object.freeze({
  CREATE: "create",
  REPLACE: "replace",
  MERGE: "merge",
  CONFLICT: "conflict",
  REMOVE: "remove",
  NOOP: "noop",
});

const STRATEGIES = Object.freeze(Object.values(STRATEGY));

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hashFile(absPath) {
  return sha256(fs.readFileSync(absPath));
}

/**
 * Normaliza y asegura que una ruta queda dentro del repo. Devuelve ruta
 * relativa POSIX. Lanza si escapa.
 */
function safeRelPath(repoRoot, target) {
  const absRoot = path.resolve(repoRoot);
  const abs = path.resolve(absRoot, target);
  const rel = path.relative(absRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`ruta fuera del repositorio: ${target}`);
  }
  return rel.split(path.sep).join("/");
}

/**
 * Construye un artefacto deseado validado.
 */
function desiredArtifact(input) {
  if (!input || typeof input !== "object") throw new TypeError("desiredArtifact requiere objeto");
  if (typeof input.path !== "string" || input.path.trim() === "") throw new TypeError("artifact.path requerido");
  if (!STRATEGIES.includes(input.strategy)) throw new TypeError(`artifact.strategy inválida: ${input.strategy}`);
  if (typeof input.distHash !== "string" || input.distHash.trim() === "") throw new TypeError("artifact.distHash requerido");
  return Object.freeze({
    path: input.path,
    owner: input.owner || "core",
    strategy: input.strategy,
    distHash: input.distHash,
    version: input.version || null,
  });
}

/**
 * Lee el inventario persistido; devuelve estructura vacía si no existe.
 */
function readInventory(repoRoot) {
  const file = path.join(repoRoot, INVENTORY_FILENAME);
  if (!fs.existsSync(file)) {
    return { schemaVersion: SCHEMA_VERSION, entries: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed.entries) parsed.entries = {};
  return parsed;
}

/**
 * Detecta si el repo tiene una instalación legacy 0.1.0 (core .claude sin
 * inventario de seguridad). Heurística no destructiva.
 */
function detectLegacyInstall(repoRoot) {
  const hasClaude = fs.existsSync(path.join(repoRoot, ".claude"));
  const hasInventory = fs.existsSync(path.join(repoRoot, INVENTORY_FILENAME));
  const hasAuditConfig = fs.existsSync(path.join(repoRoot, "kiritek-audit.config.json"));
  return !hasInventory && (hasClaude || hasAuditConfig);
}

/**
 * Descubre el estado real de un artefacto deseado en el disco, comparándolo
 * con el inventario. No muta nada.
 *
 * @returns {object} entrada de descubrimiento con operación clasificada.
 */
function discoverArtifact(repoRoot, artifact, inventory) {
  const rel = safeRelPath(repoRoot, artifact.path);
  const abs = path.join(repoRoot, rel);
  const recorded = inventory.entries[rel] || null;

  const result = {
    path: rel,
    owner: artifact.owner,
    strategy: artifact.strategy,
    exists: false,
    installedByKiritek: !!recorded,
    customized: false,
    empty: false,
    symlinkEscape: false,
    operation: OPERATION.CREATE,
  };

  let stat;
  try {
    stat = fs.lstatSync(abs);
  } catch (_) {
    // No existe en disco.
    result.operation = OPERATION.CREATE;
    return result;
  }

  result.exists = true;

  if (stat.isSymbolicLink()) {
    const realTarget = fs.realpathSync(abs);
    const relReal = path.relative(path.resolve(repoRoot), realTarget);
    if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
      result.symlinkEscape = true;
      result.operation = OPERATION.CONFLICT;
      return result;
    }
  }

  if (stat.isFile() && stat.size === 0) {
    result.empty = true;
  }

  // ¿El contenido en disco coincide con lo que Kiritek instaló?
  let currentHash = null;
  if (stat.isFile()) {
    try {
      currentHash = hashFile(abs);
    } catch (_) {
      currentHash = null;
    }
  }

  if (recorded && currentHash && recorded.installedHash && currentHash !== recorded.installedHash) {
    result.customized = true;
  }

  // Clasificación de operación por estrategia.
  switch (artifact.strategy) {
    case STRATEGY.OWNED:
      if (!result.exists) result.operation = OPERATION.CREATE;
      else if (currentHash === artifact.distHash) result.operation = OPERATION.NOOP;
      else if (result.customized) result.operation = OPERATION.CONFLICT; // usuario cambió un archivo owned
      else result.operation = OPERATION.REPLACE; // actualizar a nueva distribución
      break;
    case STRATEGY.MANAGED_BLOCK:
      result.operation = result.exists ? OPERATION.MERGE : OPERATION.CREATE;
      break;
    case STRATEGY.GENERATED:
      if (!result.exists) result.operation = OPERATION.CREATE;
      else result.operation = OPERATION.NOOP; // no re-generar
      break;
    case STRATEGY.USER_OWNED:
      result.operation = result.exists ? OPERATION.NOOP : OPERATION.CREATE;
      break;
    default:
      result.operation = OPERATION.CONFLICT;
  }

  return result;
}

/**
 * Descubre el estado para un conjunto de artefactos deseados.
 *
 * @returns {{ legacy: boolean, items: object[], summary: object }}
 */
function discover(repoRoot, desired) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("discover.repoRoot requerido");
  }
  const inventory = readInventory(repoRoot);
  const items = desired.map((a) => discoverArtifact(repoRoot, a, inventory));

  const summary = { create: 0, replace: 0, merge: 0, conflict: 0, remove: 0, noop: 0 };
  for (const it of items) summary[it.operation] += 1;

  return {
    legacy: detectLegacyInstall(repoRoot),
    items,
    summary,
  };
}

module.exports = {
  INVENTORY_FILENAME,
  SCHEMA_VERSION,
  STRATEGY,
  STRATEGIES,
  OPERATION,
  sha256,
  hashFile,
  safeRelPath,
  desiredArtifact,
  readInventory,
  detectLegacyInstall,
  discoverArtifact,
  discover,
};
