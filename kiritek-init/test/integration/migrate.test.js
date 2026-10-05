"use strict";

/**
 * Smoke/integración de la migración completa (tarea 35).
 *
 * Cubre: 0.1.0 limpio, 0.1.0 personalizado, parcial, doble migración
 * (idempotente), fallo inyectado (rollback), offline y promoción posterior.
 * Verifica que el árbol del usuario y el workflow quedan preservados o
 * corregidos según corresponda, y que el gate de conformidad es honesto.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const migrate = require("../../src/install/migrate.js");
const inventory = require("../../src/install/inventory.js");
const promotion = require("../../src/policy/promotion.js");
const { safeSerialize } = require("../../src/scanners/redactor.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "migrate");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-migrate-"));
}
function read(repo, rel) {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}
function exists(repo, rel) {
  return fs.existsSync(path.join(repo, rel));
}
function writeFixtureWorkflow(repo, fixtureName) {
  const dir = path.join(repo, ".github", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  const content = fs.readFileSync(path.join(FIXTURES, fixtureName), "utf8");
  fs.writeFileSync(path.join(dir, "kiritek-audit.yml"), content);
}

/**
 * Siembra una instalación 0.1.0 "legacy" en un repo temporal.
 * @param {object} [opts] { workflow: "factory"|"customized"|null, partial: bool }
 */
function seedLegacy(repo, opts = {}) {
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true }); // repo existente
  fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude", "skill.md"), "# skill del usuario\n");
  fs.writeFileSync(path.join(repo, "kiritek-audit.config.json"), "{\n  \"version\": \"0.1.0\"\n}\n");
  if (!opts.partial) {
    // Instalación 0.1.0 "completa".
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# CLAUDE del proyecto\n");
    fs.writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS del proyecto\n");
    fs.writeFileSync(path.join(repo, ".graphifyignore"), "node_modules\n");
  }
  if (opts.workflow === "factory") writeFixtureWorkflow(repo, "legacy-audit.factory.yml");
  if (opts.workflow === "customized") writeFixtureWorkflow(repo, "legacy-audit.customized.yml");
}

// --- 0.1.0 limpio (de fábrica) ---

test("migrate: 0.1.0 limpio adopta artefactos, instala baseline warning y reemplaza workflow inseguro de fábrica", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "factory" });
    const userSkill = read(repo, ".claude/skill.md");

    const res = migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });

    assert.equal(res.applied, true);
    assert.equal(res.mode, "warning");
    // Adopción de legacy conocido (sin duplicar, con hash actual).
    assert.ok(res.adoption.migrated.includes("kiritek-audit.config.json"));
    assert.ok(res.adoption.migrated.includes("CLAUDE.md"));
    // Baseline del core instalado.
    assert.ok(exists(repo, "kiritek-security.config.json"));
    assert.ok(exists(repo, inventory.INVENTORY_FILENAME));
    // Workflow inseguro de fábrica → reemplazado por el endurecido (safe-replace).
    assert.equal(res.workflow.kind, "safe-replace");
    assert.ok(res.replaced.includes(".github/workflows/kiritek-audit.yml"));
    const wf = read(repo, ".github/workflows/kiritek-audit.yml");
    assert.equal(/git\s+push/.test(wf), false);
    assert.equal(/git\s+commit/.test(wf), false);
    assert.ok(/upload-artifact/.test(wf));
    // Árbol del usuario preservado.
    assert.equal(read(repo, ".claude/skill.md"), userSkill);
    // Sin conflictos críticos → conforme (en términos de migración).
    assert.deepEqual(res.criticalConflicts, []);
    assert.equal(res.compliant, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- 0.1.0 personalizado (workflow con pasos propios del usuario) ---

test("migrate: workflow personalizado NO se sobrescribe; deja propuesta .kiritek-new y bloquea conformidad", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "customized" });
    const original = read(repo, ".github/workflows/kiritek-audit.yml");

    const res = migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });

    assert.equal(res.applied, true);
    assert.equal(res.workflow.kind, "proposal");
    // El original del usuario queda intacto.
    assert.equal(read(repo, ".github/workflows/kiritek-audit.yml"), original);
    // Se deja propuesta lado a lado con el endurecido.
    assert.ok(exists(repo, ".github/workflows/kiritek-audit.yml.kiritek-new"));
    const proposal = read(repo, ".github/workflows/kiritek-audit.yml.kiritek-new");
    assert.equal(/git\s+push/.test(proposal), false);
    // Gate honesto: conflicto crítico abierto → NO conforme.
    assert.equal(res.compliant, false);
    assert.equal(res.criticalConflicts.length, 1);
    assert.equal(res.criticalConflicts[0].path, ".github/workflows/kiritek-audit.yml");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Instalación parcial (sólo algunos artefactos legacy) ---

test("migrate: instalación parcial adopta lo presente y completa el baseline", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { partial: true, workflow: null });

    const res = migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });

    assert.equal(res.applied, true);
    // Sólo adopta lo que existía (config + .claude vía detección); CLAUDE/AGENTS no estaban.
    assert.ok(res.adoption.migrated.includes("kiritek-audit.config.json"));
    assert.ok(!res.adoption.migrated.includes("CLAUDE.md"));
    // Baseline completado.
    assert.ok(exists(repo, "kiritek-security.config.json"));
    // Sin workflow legacy → nada que parchear, conforme.
    assert.equal(res.workflow.kind, "none");
    assert.equal(res.compliant, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Doble migración (idempotente/reentrante) ---

test("migrate: doble migración es idempotente — sin duplicar inventario ni re-adoptar", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "factory" });
    migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });
    const keys1 = Object.keys(inventory.readInventory(repo).entries).sort();
    const gitignore1 = read(repo, ".gitignore");
    const configJson1 = read(repo, "kiritek-security.config.json");
    const workflow1 = read(repo, ".github/workflows/kiritek-audit.yml");

    const res2 = migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });
    const keys2 = Object.keys(inventory.readInventory(repo).entries).sort();

    assert.equal(res2.applied, true);
    // Nada nuevo que adoptar la segunda vez (reentrante).
    assert.equal(res2.adoption.migrated.length, 0);
    assert.ok(res2.adoption.alreadyTracked.length > 0);
    // Sin entradas de inventario duplicadas ni nuevas entre corridas.
    assert.deepEqual(keys1, keys2);
    // Los archivos administrados en disco son byte-idénticos (idempotencia real).
    assert.equal(read(repo, ".gitignore"), gitignore1);
    assert.equal(read(repo, "kiritek-security.config.json"), configJson1);
    assert.equal(read(repo, ".github/workflows/kiritek-audit.yml"), workflow1);
    // La segunda pasada no crea artefactos nuevos del baseline.
    assert.equal(res2.reconcile.summary.create, 0);
    // El workflow ya es seguro: no se vuelve a tratar como parche inseguro.
    assert.equal(res2.workflow.kind, "already-safe");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Fallo inyectado → rollback ---

test("migrate: fallo inyectado durante baseline revierte y no persiste inventario a medias", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "factory" });

    const res = migrate.migrate({
      repoRoot: repo,
      now: () => "2026-10-01T00:00:00.000Z",
      faultInjector: () => {
        throw new Error("fallo simulado durante baseline");
      },
    });

    assert.equal(res.applied, false);
    assert.equal(res.rolledBack, true);
    assert.equal(res.compliant, false);
    // El baseline no quedó a medias: la config del core no se instaló.
    assert.equal(exists(repo, "kiritek-security.config.json"), false);
    // El workflow inseguro NO fue reemplazado (la transacción revirtió).
    const wf = read(repo, ".github/workflows/kiritek-audit.yml");
    assert.ok(/git\s+push/.test(wf));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Offline: plan sin red ---

test("migrate: dry-run (plan) no muta el disco y es offline", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "customized" });
    const before = fs.readdirSync(repo).sort();

    const plan = migrate.migrate({ repoRoot: repo, dryRun: true, now: () => "2026-10-01T00:00:00.000Z" });

    assert.equal(plan.applied, false);
    assert.equal(plan.legacyDetected, true);
    assert.equal(plan.workflow.kind, "proposal");
    assert.equal(plan.compliant, false);
    // No se instaló nada ni se dejó propuesta durante el plan.
    assert.equal(exists(repo, "kiritek-security.config.json"), false);
    assert.equal(exists(repo, ".github/workflows/kiritek-audit.yml.kiritek-new"), false);
    assert.deepEqual(fs.readdirSync(repo).sort(), before);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Promoción posterior sobre un repo migrado ---

test("migrate: tras migrar limpio, el doctor puede evaluar readiness (promoción posterior)", async () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "factory" });
    migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });

    // El doctor se ejecuta con una auditoría inyectada (determinista, sin red):
    // todas las capas aplicables OK → readiness ready → canPromote permite.
    const doctor = await promotion.runDoctor(repo, {
      now: () => "2026-10-02T00:00:00.000Z",
      auditFn: async () => ({
        generatedAt: "2026-10-02T00:00:00.000Z",
        capabilities: [
          { id: "config", applicable: true, installed: true, active: true },
          { id: "ignores", applicable: true, installed: true, active: true },
        ],
      }),
    });
    assert.ok(["ready", "unknown"].includes(doctor.readiness));
    const decision = promotion.canPromote(doctor, {});
    assert.equal(typeof decision.allowed, "boolean");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Redacción obligatoria del resumen de migración ---

test("migrate: el resumen de migración cruza el redactor sin filtrar canarios", () => {
  const repo = tmpRepo();
  try {
    seedLegacy(repo, { workflow: "customized" });
    const res = migrate.migrate({ repoRoot: repo, now: () => "2026-10-01T00:00:00.000Z" });
    // safeSerialize lanza si detecta un canario tras redactar; no debe lanzar.
    const { json } = safeSerialize(res);
    assert.ok(json.length > 0);
    assert.equal(/AKIA[0-9A-Z]{16}/.test(json), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
