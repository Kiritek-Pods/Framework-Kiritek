"use strict";

/**
 * Migración reentrante y transaccional de instalaciones previas (0.1.0),
 * parciales y personalizadas al modelo con inventario + seguridad integral.
 *
 * Esta migración NUNCA pisa el trabajo del usuario. Su contrato:
 *
 *  1. ADOPTAR (35.1): una instalación legacy (0.1.0) no tiene
 *     `.kiritek/inventory.json`. Migrar no reinstala ni sobrescribe los
 *     artefactos legacy existentes: los ADOPTA en el inventario con su hash
 *     ACTUAL. Así el usuario no se marca como "drift" por algo que Kiritek
 *     nunca registró; de ahí en adelante sí se detectan sus cambios. Hooks,
 *     config y docs personalizados se preservan tal cual.
 *
 *  2. BASELINE EN WARNING (35.2): se instala el pack `core/security` en modo
 *     `warning` (no romper repos existentes). La promoción a `enforce` es un
 *     paso posterior y gobernado (tarea 33). Se reutiliza el reconciliador
 *     transaccional: un artefacto no personalizado se crea/reemplaza; uno
 *     personalizado produce CONFLICT → propuesta `.kiritek-new` lado a lado,
 *     nunca un overwrite silencioso.
 *
 *  3. CORREGIR WORKFLOW INSEGURO (35.2/35.3): el workflow semanal 0.1.0 hace
 *     commit/push directo (viola rama protegida y filtra). Se identifica como
 *     "parche crítico". Si el usuario NO lo personalizó, se reemplaza por el
 *     endurecido mediante un replace seguro y transaccional. Si lo personalizó,
 *     NO se sobrescribe: se deja una propuesta/diff `.kiritek-new` para
 *     resolución explícita, y el conflicto queda ABIERTO.
 *
 *  4. GATE DE CONFORMIDAD HONESTO (35.3): mientras exista un conflicto CRÍTICO
 *     sin resolver (p. ej. el workflow inseguro personalizado que sigue
 *     empujando), la migración NO puede declararse `compliant`. Se dice la
 *     verdad: `compliant: false` con los bloqueos listados.
 *
 *  5. OFFLINE / REENTRANTE / ROLLBACK (35.4): la migración no requiere red
 *     (todo el baseline vive en templates locales / cache). Correrla dos veces
 *     produce el mismo inventario sin duplicar entradas. Un fallo parcial se
 *     revierte vía la transacción del reconciliador y puede reanudarse.
 *
 * Toda salida (resumen de migración, evidencia) está pensada para cruzar el
 * redactor obligatorio: no incluye secretos, contenido de archivos del usuario
 * ni líneas fuente.
 *
 * (Requisitos 20.1, 21.1–21.11, 26.3, G.2, G.8, G.13.)
 */

const fs = require("fs");
const path = require("path");

const inventory = require("./inventory.js");
const coreSecurity = require("./core-security.js");
const { reconcile } = require("./reconcile.js");
const merge = require("./merge.js");

/** Artefactos legacy conocidos y la estrategia con la que se adoptan. */
const LEGACY_ARTIFACTS = Object.freeze([
  { path: "kiritek-audit.config.json", owner: "core", strategy: inventory.STRATEGY.OWNED },
  { path: "CLAUDE.md", owner: "core", strategy: inventory.STRATEGY.GENERATED },
  { path: "AGENTS.md", owner: "core", strategy: inventory.STRATEGY.GENERATED },
  { path: ".graphifyignore", owner: "core", strategy: inventory.STRATEGY.MANAGED_BLOCK },
]);

/**
 * Rutas candidatas del workflow de auditoría semanal 0.1.0 dentro de un repo.
 * El workflow 0.1.0 hacía commit/push directo del reporte: es un parche crítico.
 */
const LEGACY_WORKFLOW_CANDIDATES = Object.freeze([
  ".github/workflows/kiritek-audit.yml",
  ".github/workflows/kiritek-audit.yaml",
]);

/** Ruta del workflow de auditoría endurecido (parche seguro, local). */
const HARDENED_AUDIT_WORKFLOW = path.join(
  __dirname,
  "..",
  "..",
  "metrics",
  "kiritek-audit.yml"
);

/**
 * Patrones que delatan un workflow inseguro (push/commit directo del reporte).
 * Si un workflow legacy los contiene, es un parche CRÍTICO.
 */
const INSECURE_WORKFLOW_PATTERNS = Object.freeze([/git\s+push/, /git\s+commit/]);

/* -------------------------------------------------------------------------- */
/* 35.1 — Adopción de artefactos legacy (preservación)                         */
/* -------------------------------------------------------------------------- */

/**
 * Adopta en el inventario los artefactos legacy presentes. No muta los archivos.
 * Reentrante: no duplica ni re-sella entradas ya registradas.
 *
 * @param {string} repoRoot
 * @param {object} [opts] { now }
 * @returns {{ migrated: string[], alreadyTracked: string[], inventory: object }}
 */
function migrateLegacy(repoRoot, opts = {}) {
  const now = opts.now ? opts.now() : new Date().toISOString();
  const inv = inventory.readInventory(repoRoot);
  const entries = { ...inv.entries };

  const migrated = [];
  const alreadyTracked = [];

  for (const art of LEGACY_ARTIFACTS) {
    const abs = path.join(repoRoot, art.path);
    if (!fs.existsSync(abs)) continue;
    if (entries[art.path]) {
      alreadyTracked.push(art.path);
      continue; // reentrante: no duplica ni re-sella
    }
    let installedHash = null;
    try {
      installedHash = inventory.hashFile(abs);
    } catch (_) {
      installedHash = null;
    }
    entries[art.path] = {
      owner: art.owner,
      strategy: art.strategy,
      // Se adopta con el hash actual: el usuario no se marca como "drift" por
      // algo que Kiritek nunca registró; a partir de aquí sí se detectan cambios.
      installedHash: installedHash || "adopted",
      version: null,
      installedAt: now,
      adopted: true,
    };
    migrated.push(art.path);
  }

  return {
    migrated,
    alreadyTracked,
    inventory: { schemaVersion: inventory.SCHEMA_VERSION, entries },
  };
}

/**
 * Persiste el inventario migrado de forma atómica.
 */
function writeMigratedInventory(repoRoot, migratedInventory) {
  const file = path.join(repoRoot, inventory.INVENTORY_FILENAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(migratedInventory, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return file;
}

/* -------------------------------------------------------------------------- */
/* 35.3 — Detección de parches críticos (workflow inseguro)                    */
/* -------------------------------------------------------------------------- */

/**
 * Localiza el workflow de auditoría legacy en el repo, si existe.
 * @returns {string|null} ruta relativa POSIX o null.
 */
function findLegacyWorkflow(repoRoot) {
  for (const candidate of LEGACY_WORKFLOW_CANDIDATES) {
    if (fs.existsSync(path.join(repoRoot, candidate))) return candidate;
  }
  return null;
}

/**
 * ¿El contenido de un workflow es inseguro (commit/push directo)?
 */
function isInsecureWorkflow(content) {
  const text = typeof content === "string" ? content : "";
  return INSECURE_WORKFLOW_PATTERNS.some((re) => re.test(text));
}

/**
 * Lee el contenido del workflow endurecido (parche seguro). Local; sin red.
 */
function readHardenedWorkflow() {
  return fs.readFileSync(HARDENED_AUDIT_WORKFLOW, "utf8");
}

/**
 * Analiza el workflow legacy y decide el parche crítico SIN mutar nada.
 *
 * Resultado posible:
 *  - `none`:        no hay workflow legacy; nada que parchear.
 *  - `already-safe`: hay workflow pero ya es seguro (coincide con el endurecido
 *                    o no contiene push/commit); no se toca.
 *  - `safe-replace`: workflow inseguro NO personalizado por el usuario → se
 *                    puede reemplazar de forma segura por el endurecido.
 *  - `proposal`:     workflow inseguro PERSONALIZADO → no se sobrescribe; se
 *                    deja propuesta `.kiritek-new` y queda como conflicto
 *                    CRÍTICO abierto hasta resolución explícita.
 *
 * @param {string} repoRoot
 * @returns {object}
 */
function analyzeWorkflowPatch(repoRoot) {
  const relPath = findLegacyWorkflow(repoRoot);
  if (!relPath) {
    return { kind: "none", relPath: null, critical: false, insecure: false };
  }
  const abs = path.join(repoRoot, relPath);
  const current = fs.readFileSync(abs, "utf8");
  const hardened = readHardenedWorkflow();

  if (!isInsecureWorkflow(current)) {
    return { kind: "already-safe", relPath, critical: false, insecure: false };
  }

  // Es inseguro: ¿está en inventario y coincide con lo que Kiritek instaló?
  const inv = inventory.readInventory(repoRoot);
  const recorded = inv.entries[relPath] || null;
  let currentHash = null;
  try {
    currentHash = inventory.hashFile(abs);
  } catch (_) {
    currentHash = null;
  }

  // "Personalizado" = Kiritek lo tenía registrado y el usuario lo cambió, O no
  // está registrado pero difiere del endurecido de referencia. Como un workflow
  // inseguro siempre difiere del endurecido, usamos el inventario como señal de
  // autoría: si Kiritek nunca lo selló (adopción legacy sin firma propia),
  // tratamos cualquier edición respecto al 0.1.0 original como personalización.
  const customized =
    !!recorded && recorded.installedHash && currentHash && currentHash !== recorded.installedHash;

  // Firma del workflow 0.1.0 "de fábrica" (sin personalizar): hace push/commit
  // pero no incorpora pasos de usuario. Heurística conservadora: si el workflow
  // sólo contiene el patrón legacy conocido lo tratamos como reemplazable; si
  // el usuario añadió pasos propios, lo tratamos como propuesta.
  const looksFactory = isFactoryLegacyWorkflow(current);

  if (customized || !looksFactory) {
    return {
      kind: "proposal",
      relPath,
      critical: true,
      insecure: true,
      hardened,
      reason: "workflow inseguro personalizado: no se sobrescribe, se propone un diff",
    };
  }

  return {
    kind: "safe-replace",
    relPath,
    critical: true,
    insecure: true,
    hardened,
    reason: "workflow inseguro de fábrica: se reemplaza por el endurecido",
  };
}

/**
 * ¿El workflow legacy luce "de fábrica" 0.1.0 (sin personalización del usuario)?
 * Un workflow de fábrica hace push/commit del reporte pero no agrega jobs/pasos
 * ajenos a la auditoría. Heurística conservadora que prefiere "proposal" ante la
 * duda (nunca sobrescribe trabajo del usuario sin estar seguro).
 */
function isFactoryLegacyWorkflow(content) {
  const text = String(content);
  // Señales típicas del workflow 0.1.0: nombre de auditoría + comando audit.
  const mentionsAudit = /kiritek[-\s]?audit|Framework-Kiritek|\baudit\b/i.test(text);
  // Señal de personalización explícita: pasos ajenos a la auditoría. Se usan
  // límites de palabra para no confundir subcadenas inocentes (p. ej.
  // `npx-release` en una URL de distribución no es un paso de "release").
  const customSteps = /\b(deploy|publish|notify|slack|discord)\b/i.test(text);
  // Nº de jobs reales: entradas con 2 espacios de indent DENTRO del bloque
  // `jobs:`. Evitamos contar claves de otros bloques (p. ej. `on:`), que
  // también usan 2 espacios, acotando el conteo a lo que sigue a `jobs:`.
  const jobCount = countJobs(text);
  return mentionsAudit && !customSteps && jobCount <= 1;
}

/**
 * Cuenta los jobs declarados bajo el bloque `jobs:` de un workflow YAML.
 * Heurística textual conservadora (sin dependencia YAML): a partir de la línea
 * `jobs:`, cuenta claves con exactamente 2 espacios de indent hasta que la
 * indentación vuelve al nivel raíz.
 */
function countJobs(text) {
  const lines = String(text).split(/\r?\n/);
  let inJobs = false;
  let count = 0;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line) && line.trim() !== "") break; // volvió al nivel raíz
    if (/^\s{2}[\w-]+:\s*$/.test(line)) count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* 35.2 + 35.4 — Orquestación transaccional de la migración completa           */
/* -------------------------------------------------------------------------- */

/**
 * Construye el PLAN de migración sin mutar nada (apto para dry-run / diff).
 *
 * @param {string} repoRoot
 * @param {object} [opts] { now }
 * @returns {object} plan honesto con adopción, baseline y parche de workflow.
 */
function planMigration(repoRoot, opts = {}) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("planMigration.repoRoot requerido");
  }
  const legacyDetected = inventory.detectLegacyInstall(repoRoot);
  const adoption = migrateLegacy(repoRoot, opts);

  // Baseline en WARNING, en dry-run para no mutar durante el plan.
  const baseline = coreSecurity.installCore({ repoRoot, dryRun: true });

  const workflow = analyzeWorkflowPatch(repoRoot);

  // Conflictos del baseline (artefactos personalizados que no se sobrescriben).
  const baselineConflicts = (baseline.reconcile && baseline.reconcile.conflicts) || [];

  // Un conflicto CRÍTICO es el workflow inseguro que sigue abierto como propuesta.
  const criticalConflicts = [];
  if (workflow.kind === "proposal") {
    criticalConflicts.push({
      path: workflow.relPath,
      reason: "workflow de auditoría inseguro (commit/push directo) personalizado y sin resolver",
    });
  }

  return {
    legacyDetected,
    adoption: {
      migrated: adoption.migrated,
      alreadyTracked: adoption.alreadyTracked,
    },
    baseline: {
      mode: baseline.mode,
      projectType: baseline.projectType,
      plan: (baseline.reconcile && baseline.reconcile.plan) || [],
      conflicts: baselineConflicts,
    },
    workflow: {
      kind: workflow.kind,
      path: workflow.relPath,
      insecure: workflow.insecure,
      critical: workflow.critical,
    },
    criticalConflicts,
  };
}

/**
 * Ejecuta la migración completa de forma transaccional y reentrante.
 *
 * Orden:
 *   1. Adoptar artefactos legacy en el inventario (preservación).
 *   2. Instalar baseline `core/security` en WARNING vía reconciliador
 *      transaccional (los personalizados → `.kiritek-new`, sin overwrite).
 *   3. Aplicar el parche crítico del workflow:
 *        - safe-replace → reconciliador reemplaza el workflow inseguro.
 *        - proposal     → se escribe `<wf>.kiritek-new` y queda conflicto abierto.
 *   4. Calcular el veredicto de conformidad HONESTO: `compliant: false`
 *      mientras exista un conflicto crítico sin resolver.
 *
 * Reentrante: una segunda corrida no duplica inventario ni vuelve a proponer lo
 * ya adoptado. Offline: no requiere red (todo local). Rollback: cualquier fallo
 * en el baseline revierte vía la transacción del reconciliador.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {boolean} [opts.dryRun]
 * @param {() => string} [opts.now]
 * @param {() => void} [opts.faultInjector]  Para pruebas de rollback.
 * @returns {object} resultado de migración (apto para redactor).
 */
function migrate(opts = {}) {
  const { repoRoot } = opts;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("migrate.repoRoot requerido");
  }
  const dryRun = !!opts.dryRun;

  const plan = planMigration(repoRoot, { now: opts.now });

  if (dryRun) {
    return {
      dryRun: true,
      applied: false,
      ...plan,
      proposals: [],
      replaced: [],
      compliant: false,
      compliantBlockers: plan.criticalConflicts.map((c) => c.reason),
    };
  }

  // 1. Adoptar artefactos legacy y persistir inventario (reentrante).
  const adoption = migrateLegacy(repoRoot, { now: opts.now });
  if (adoption.migrated.length > 0) {
    writeMigratedInventory(repoRoot, adoption.inventory);
  }

  // 2. Construir los deseados: baseline del core + (si aplica) el workflow
  //    endurecido como artefacto `owned` para que el reconciliador decida
  //    create/replace/conflict de forma transaccional y uniforme.
  const workflow = analyzeWorkflowPatch(repoRoot);
  const desired = coreSecurity.buildDesiredArtifacts();

  if (workflow.kind === "safe-replace") {
    desired.push({
      ...inventory.desiredArtifact({
        path: workflow.relPath,
        strategy: inventory.STRATEGY.OWNED,
        distHash: inventory.sha256(Buffer.from(workflow.hardened)),
        owner: "core",
      }),
      content: workflow.hardened,
    });
  }

  const rec = reconcile({
    repoRoot,
    desired,
    faultInjector: opts.faultInjector,
    selfCheck: opts.selfCheck,
  });

  if (rec.applied !== true) {
    // Fallo → rollback ya ejecutado por el reconciliador. Migración no conforme.
    return {
      dryRun: false,
      applied: false,
      rolledBack: !!rec.rolledBack,
      restored: rec.restored || [],
      error: rec.error || "reconciliación fallida",
      adoption: { migrated: adoption.migrated, alreadyTracked: adoption.alreadyTracked },
      compliant: false,
      compliantBlockers: ["migración revertida por fallo transaccional"],
    };
  }

  const proposals = [...(rec.proposals || [])];
  const replaced = [];
  const openCriticalConflicts = [];

  if (workflow.kind === "safe-replace") {
    replaced.push(workflow.relPath);
  } else if (workflow.kind === "proposal") {
    // No sobrescribir: dejar propuesta `.kiritek-new` lado a lado y marcar el
    // conflicto crítico como abierto. Escritura idempotente (reentrante).
    const proposalRel = merge.proposalPath(workflow.relPath);
    const proposalAbs = path.join(repoRoot, proposalRel);
    const existing = fs.existsSync(proposalAbs) ? fs.readFileSync(proposalAbs, "utf8") : null;
    if (existing !== workflow.hardened) {
      fs.mkdirSync(path.dirname(proposalAbs), { recursive: true });
      const tmp = `${proposalAbs}.tmp`;
      fs.writeFileSync(tmp, workflow.hardened);
      fs.renameSync(tmp, proposalAbs);
    }
    proposals.push(proposalRel);
    openCriticalConflicts.push({
      path: workflow.relPath,
      proposal: proposalRel,
      reason: "workflow de auditoría inseguro (commit/push directo) personalizado y sin resolver",
    });
  }

  // 3. Reconciliación de stacks/Jira/asistentes/providers: la migración NO
  //    reimplementa estos adaptadores; delega en el baseline del core y
  //    reporta qué quedó pendiente de configuración. Los artefactos de stacks,
  //    asistentes y providers se instalan por sus propios reconciliadores
  //    (tareas 24–25, 27) sobre el MISMO inventario, por lo que la migración
  //    sólo deja el baseline listo y señala la continuación.
  const reconciled = {
    core: true,
    note: "stacks/Jira/asistentes/providers se reconcilian con sus packs sobre el mismo inventario",
  };

  // 4. Veredicto de conformidad honesto (gate crítico).
  const criticalConflicts = openCriticalConflicts;
  const compliant = criticalConflicts.length === 0;

  return {
    dryRun: false,
    applied: true,
    legacyDetected: plan.legacyDetected,
    mode: "warning",
    adoption: { migrated: adoption.migrated, alreadyTracked: adoption.alreadyTracked },
    reconcile: { summary: rec.summary, conflicts: rec.conflicts || [] },
    workflow: {
      kind: workflow.kind,
      path: workflow.relPath,
      insecure: workflow.insecure,
      critical: workflow.critical,
    },
    reconciled,
    replaced,
    proposals,
    criticalConflicts,
    compliant,
    compliantBlockers: criticalConflicts.map((c) => c.reason),
  };
}

module.exports = {
  LEGACY_ARTIFACTS,
  LEGACY_WORKFLOW_CANDIDATES,
  HARDENED_AUDIT_WORKFLOW,
  INSECURE_WORKFLOW_PATTERNS,
  migrateLegacy,
  writeMigratedInventory,
  findLegacyWorkflow,
  isInsecureWorkflow,
  isFactoryLegacyWorkflow,
  countJobs,
  analyzeWorkflowPatch,
  planMigration,
  migrate,
};
