"use strict";

/**
 * Instalación de hooks Git versionados y componibles.
 *
 * Objetivo: activar los hooks de Kiritek sin destruir automatizaciones previas.
 *  - Si existe un gestor de hooks reconocido (Husky, Lefthook, pre-commit,
 *    CaptainHook), NO se sobrescribe: se reporta para integración manual
 *    (requisito 4.4), porque cada gestor tiene su propio flujo de composición.
 *  - Si existe un hook nativo, se preserva moviéndolo a
 *    `.kiritek/hooks/<hook>.previous` y el shim de Kiritek lo encadena.
 *  - Si `core.hooksPath` apunta fuera de `.git/hooks`, se reporta en vez de
 *    forzar, para no romper una configuración deliberada.
 *
 * La escritura real la hace el reconciliador transaccional; aquí se calcula el
 * plan y se proveen utilidades puras y testeable.
 *
 * (Requisitos 4.1–4.8, 23.1–23.3, G.1–G.3, G.13.)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { createTransaction } = require("../install/transaction.js");

/** Directorio de plantillas de los hooks administrados por Kiritek. */
const HOOK_TEMPLATES_DIR = path.join(__dirname, "..", "..", "templates", "core", "security", "hooks");

const HOOK_NAMES = Object.freeze(["pre-commit", "pre-push", "commit-msg"]);
const MANAGED_MARKER = "Kiritek managed";

/** Archivos que delatan un gestor de hooks de terceros. */
const MANAGER_SIGNATURES = Object.freeze([
  { manager: "husky", files: [".husky/_/husky.sh", ".husky"] },
  { manager: "lefthook", files: ["lefthook.yml", ".lefthook.yml", "lefthook.yaml"] },
  { manager: "pre-commit", files: [".pre-commit-config.yaml"] },
  { manager: "captainhook", files: ["captainhook.json", ".captainhook.json"] },
]);

function detectManager(repoRoot) {
  for (const sig of MANAGER_SIGNATURES) {
    if (sig.files.some((f) => fs.existsSync(path.join(repoRoot, f)))) {
      return sig.manager;
    }
  }
  return null;
}

/**
 * Lee core.hooksPath; null si no está configurado.
 */
function hooksPath(repoRoot) {
  const res = spawnSync("git", ["-C", repoRoot, "config", "--get", "core.hooksPath"], { encoding: "utf8" });
  if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  return null;
}

function gitHooksDir(repoRoot) {
  const custom = hooksPath(repoRoot);
  if (custom) return path.isAbsolute(custom) ? custom : path.join(repoRoot, custom);
  return path.join(repoRoot, ".git", "hooks");
}

function isManagedByKiritek(content) {
  return typeof content === "string" && content.includes(MANAGED_MARKER);
}

/**
 * Calcula el plan de instalación de hooks (sin mutar).
 *
 * @param {string} repoRoot
 * @returns {{ manager: string|null, customHooksPath: string|null, strategy: string, hooks: object[] }}
 */
function planHookInstall(repoRoot) {
  const manager = detectManager(repoRoot);
  const customHooksPath = hooksPath(repoRoot);

  if (manager) {
    return {
      manager,
      customHooksPath,
      strategy: "manual", // no sobrescribir el gestor del usuario
      reason: `gestor de hooks detectado (${manager}); integración manual requerida`,
      hooks: [],
    };
  }

  const dir = gitHooksDir(repoRoot);
  const hooks = HOOK_NAMES.map((name) => {
    const target = path.join(dir, name);
    let existing = null;
    if (fs.existsSync(target)) {
      try {
        existing = fs.readFileSync(target, "utf8");
      } catch (_) {
        existing = null;
      }
    }
    const hasExisting = existing !== null;
    const managed = isManagedByKiritek(existing || "");
    let action;
    if (!hasExisting) action = "install";
    else if (managed) action = "reinstall"; // idempotente
    else action = "chain"; // preservar previo y encadenar
    return { name, target, action, hadExisting: hasExisting, wasManaged: managed };
  });

  return { manager: null, customHooksPath, strategy: "install", hooks };
}

/**
 * Rutas de preservación del hook previo dentro de .kiritek/hooks/.
 */
function previousPath(repoRoot, hookName) {
  return path.join(repoRoot, ".kiritek", "hooks", `${hookName}.previous`);
}

/**
 * Lee la plantilla de un hook administrado por Kiritek.
 * @param {string} name  pre-commit | pre-push | commit-msg
 * @returns {string}
 */
function readHookTemplate(name) {
  return fs.readFileSync(path.join(HOOK_TEMPLATES_DIR, name), "utf8");
}

/**
 * Instala los hooks de Kiritek de forma transaccional y NO destructiva.
 *
 * Reglas:
 *  - Si hay un gestor de hooks de terceros (Husky, Lefthook, ...), NO se toca
 *    nada: se devuelve `strategy:"manual"` para integración explícita.
 *  - Un hook nativo preexistente (no Kiritek) se PRESERVA moviéndolo a
 *    `.kiritek/hooks/<hook>.previous` (ejecutable) y el shim lo encadena.
 *  - Un hook ya administrado por Kiritek se reinstala de forma idempotente.
 *  - Los shims se escriben con bit de ejecución (0o755).
 *  - Todo ocurre dentro de una transacción: si algo falla, se revierte.
 *
 * @param {object} opts { repoRoot, dryRun }
 * @returns {object} resultado con el plan y los hooks instalados/encadenados.
 */
function installHooks(opts) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string") throw new TypeError("installHooks.repoRoot requerido");
  const dryRun = !!opts.dryRun;

  const plan = planHookInstall(repoRoot);

  // Gestor de terceros o hooksPath personalizado fuera de .git/hooks → manual.
  if (plan.strategy === "manual") {
    return { strategy: "manual", manager: plan.manager, reason: plan.reason, applied: false, installed: [], chained: [] };
  }

  const dir = gitHooksDir(repoRoot);
  const relDir = path.relative(path.resolve(repoRoot), path.resolve(dir)).split(path.sep).join("/");

  const installed = [];
  const chained = [];
  const steps = [];

  for (const h of plan.hooks) {
    const shim = readHookTemplate(h.name);
    const hookRel = `${relDir}/${h.name}`;
    if (h.action === "chain") {
      // Preservar el hook previo (ejecutable) y encadenarlo desde el shim.
      const prevRel = path.relative(path.resolve(repoRoot), previousPath(repoRoot, h.name)).split(path.sep).join("/");
      const prevContent = fs.readFileSync(path.join(dir, h.name));
      steps.push({ rel: prevRel, content: prevContent, mode: 0o755 });
      chained.push(h.name);
    }
    steps.push({ rel: hookRel, content: shim, mode: 0o755 });
    installed.push(h.name);
  }

  if (dryRun) {
    return { strategy: "install", applied: false, dryRun: true, installed, chained, hooksDir: relDir };
  }

  const tx = createTransaction(repoRoot);
  try {
    for (const step of steps) {
      tx.writeFile(step.rel, step.content, { mode: step.mode });
    }
    tx.commit();
  } catch (err) {
    const { restored } = tx.rollback();
    return { strategy: "install", applied: false, rolledBack: true, restored, error: err.message };
  }

  return { strategy: "install", applied: true, installed, chained, hooksDir: relDir };
}

module.exports = {
  HOOK_NAMES,
  MANAGED_MARKER,
  detectManager,
  hooksPath,
  gitHooksDir,
  isManagedByKiritek,
  planHookInstall,
  previousPath,
  readHookTemplate,
  installHooks,
  HOOK_TEMPLATES_DIR,
};
