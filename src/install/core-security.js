"use strict";

/**
 * Instalación del pack `core/security` por defecto.
 *
 * Reúne los artefactos del core (config, ignores, docs de herramientas) como
 * una lista de "deseados" para el reconciliador transaccional, separando los
 * que dependen de Git de los portables, y produce un reporte de capacidades
 * honesto por control: nada se declara `active` si su prerrequisito (Git,
 * herramienta verificada) no está presente.
 *
 * (Requisitos 1.1–1.6, 12.5, 20.1–20.3, G.1–G.2.)
 */

const fs = require("fs");
const path = require("path");

const inventory = require("./inventory.js");
const { reconcile } = require("./reconcile.js");
const hooksMod = require("../git/hooks.js");

const TEMPLATES_DIR = path.join(__dirname, "..", "..", "templates", "core", "security");

/** Capacidad / estado posible de un control. */
const CAPABILITY = Object.freeze({
  ACTIVE: "active",
  WARNING: "warning",
  UNAVAILABLE: "unavailable",
  DISABLED: "disabled",
  PENDING_CONFIGURATION: "pending_configuration",
});

function readTemplate(rel) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, rel), "utf8");
}

/**
 * Construye la lista de artefactos deseados del core.
 * Cada uno marca `gitDependent` para el reporte de capacidades.
 */
function buildDesiredArtifacts() {
  const configContent = readTemplate("config/kiritek-security.config.json");
  const gitignoreEntries = readTemplate("ignores/gitignore.entries");
  const graphifyEntries = readTemplate("ignores/graphifyignore.entries");

  const mk = (p, content, strategy, extra = {}) => ({
    ...inventory.desiredArtifact({
      path: p,
      strategy,
      distHash: inventory.sha256(Buffer.from(content)),
      owner: "core",
    }),
    content,
    ...extra,
  });

  // Artefactos portables adicionales del pack de seguridad: configuración del
  // escáner de secretos, manifiesto de herramientas (pin + checksum) y los
  // adaptadores de asistentes + CI. Se instalan bajo .kiritek/ (ownership del
  // core) salvo los que tienen una ubicación canónica propia (CI de GitHub,
  // settings/hoooks de los asistentes), para que la auditoría los reconozca.
  const gitleaksToml = readTemplate("gitleaks/gitleaks.toml");
  const toolManifest = readTemplate("tools/manifest.json");
  const claudeShim = readTemplate("adapters/claude/hooks/pretooluse.sh");
  const kiroShim = readTemplate("adapters/kiro/hooks/pretooluse.sh");
  const ciWorkflow = readTemplate("ci/github/kiritek-security.yml");

  return [
    mk("kiritek-security.config.json", configContent, inventory.STRATEGY.OWNED, { gitDependent: false }),
    mk(".gitignore", gitignoreEntries, inventory.STRATEGY.MANAGED_BLOCK, { gitDependent: true }),
    mk(".graphifyignore", graphifyEntries, inventory.STRATEGY.MANAGED_BLOCK, { gitDependent: false }),
    // Config del escáner de secretos + manifiesto pinneado (portables).
    mk(".kiritek/gitleaks.toml", gitleaksToml, inventory.STRATEGY.OWNED, { gitDependent: false }),
    mk(".kiritek/tools/manifest.json", toolManifest, inventory.STRATEGY.OWNED, { gitDependent: false }),
    // Shims de los asistentes (ejecutables); su ENLACE en settings/hooks del
    // asistente lo hace el adaptador correspondiente, no el core.
    mk(".kiritek/adapters/claude/pretooluse.sh", claudeShim, inventory.STRATEGY.OWNED, { gitDependent: false, executable: true }),
    mk(".kiritek/adapters/kiro/pretooluse.sh", kiroShim, inventory.STRATEGY.OWNED, { gitDependent: false, executable: true }),
    // Workflow de CI de seguridad (ubicación canónica de GitHub Actions).
    mk(".github/workflows/kiritek-security.yml", ciWorkflow, inventory.STRATEGY.OWNED, { gitDependent: false }),
  ];
}

/**
 * ¿El directorio es un repositorio Git?
 */
function isGitRepo(repoRoot) {
  return fs.existsSync(path.join(repoRoot, ".git"));
}

/**
 * ¿El repo es "nuevo" (sin historial relevante) o "existente"?
 * Heurística no destructiva: presencia de .git/refs o de archivos de proyecto.
 */
function isExistingProject(repoRoot) {
  const hasGit = isGitRepo(repoRoot);
  const entries = fs.existsSync(repoRoot) ? fs.readdirSync(repoRoot) : [];
  const meaningful = entries.filter((e) => e !== ".git" && e !== ".kiritek");
  return hasGit || meaningful.length > 0;
}

/**
 * Instala el core de seguridad.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} [opts.security]  "off" para omitir (requiere confirm fuera).
 * @param {boolean} [opts.dryRun]
 * @returns {object} resultado con plan/aplicado, modo y capacidades.
 */
function installCore(opts) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string") throw new TypeError("installCore.repoRoot requerido");

  if (opts.security === "off") {
    return {
      installed: false,
      securityOff: true,
      compliant: false,
      omitted: ["secret-scanning", "git-hooks", "assistant-adapters"],
      capabilities: buildCapabilities(repoRoot, { installed: false, mode: "off" }),
    };
  }

  const existing = isExistingProject(repoRoot);
  const mode = existing ? "warning" : "enforce";

  const desired = buildDesiredArtifacts();
  const result = reconcile({ repoRoot, desired, dryRun: !!opts.dryRun });

  const installed = result.applied === true || !!opts.dryRun;

  // Instalar los hooks Git (no destructivo, transaccional) cuando aplica. En
  // dry-run sólo se calcula el plan. Si hay un gestor de terceros, queda manual.
  let hooks = { strategy: "unavailable", applied: false, installed: [], chained: [] };
  if (isGitRepo(repoRoot) && result.applied !== false) {
    try {
      hooks = hooksMod.installHooks({ repoRoot, dryRun: !!opts.dryRun });
    } catch (err) {
      hooks = { strategy: "install", applied: false, error: err.message, installed: [], chained: [] };
    }
  } else if (!isGitRepo(repoRoot)) {
    hooks = { strategy: "unavailable", applied: false, reason: "no es repositorio Git", installed: [], chained: [] };
  }

  return {
    installed: result.applied === true,
    dryRun: !!opts.dryRun,
    mode,
    projectType: existing ? "existing" : "new",
    gitRepo: isGitRepo(repoRoot),
    reconcile: result,
    hooks,
    capabilities: buildCapabilities(repoRoot, {
      installed: result.applied === true,
      mode,
      hooks,
      dryRun: !!opts.dryRun,
    }),
  };
}

/**
 * Reporte de capacidades honesto por control.
 */
function buildCapabilities(repoRoot, { installed, mode, hooks, dryRun }) {
  const git = isGitRepo(repoRoot);

  // Secret scanning: el manifiesto pinneado y la config del escáner ya se
  // instalan. El manifiesto de referencia aún trae checksums placeholder (el
  // pin real por plataforma se completa fuera de banda), de modo que el control
  // queda CONFIGURADO pero no se declara "active" hasta tener el binario
  // verificado: honestidad sobre el estado, nunca enforcement simulado.
  const manifestInstalled = fs.existsSync(path.join(repoRoot, ".kiritek", "tools", "manifest.json")) || dryRun;
  const secretScan = !installed
    ? CAPABILITY.DISABLED
    : manifestInstalled
    ? CAPABILITY.PENDING_CONFIGURATION
    : CAPABILITY.DISABLED;

  // Hooks Git: ahora se instalan de verdad. active si se instalaron; manual si
  // hay un gestor de terceros; unavailable si no hay repo Git.
  let gitHooks;
  let gitHooksReason;
  if (!git) {
    gitHooks = CAPABILITY.UNAVAILABLE;
    gitHooksReason = "no es repositorio Git";
  } else if (hooks && hooks.strategy === "manual") {
    gitHooks = CAPABILITY.PENDING_CONFIGURATION;
    gitHooksReason = hooks.reason || "gestor de hooks de terceros: integración manual requerida";
  } else if (hooks && (hooks.applied === true || (dryRun && hooks.installed && hooks.installed.length))) {
    gitHooks = CAPABILITY.ACTIVE;
    gitHooksReason = null;
  } else if (hooks && hooks.error) {
    gitHooks = CAPABILITY.UNAVAILABLE;
    gitHooksReason = `fallo instalando hooks: ${hooks.error}`;
  } else {
    gitHooks = installed ? CAPABILITY.PENDING_CONFIGURATION : CAPABILITY.DISABLED;
    gitHooksReason = "hooks no instalados";
  }

  return [
    { id: "config", status: installed ? CAPABILITY.ACTIVE : CAPABILITY.DISABLED, mode },
    { id: "secret-scanning", status: secretScan, reason: manifestInstalled ? "manifiesto instalado; checksum del binario por plataforma pendiente de pin real" : "pin de herramienta pendiente" },
    { id: "git-hooks", status: gitHooks, reason: gitHooksReason },
    { id: "ignores", status: installed ? CAPABILITY.ACTIVE : CAPABILITY.DISABLED },
  ];
}

module.exports = {
  CAPABILITY,
  TEMPLATES_DIR,
  buildDesiredArtifacts,
  isGitRepo,
  isExistingProject,
  installCore,
  buildCapabilities,
};
